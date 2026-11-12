import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, createTestDb, createUser } from "./harness";
import { splitOrder, type SplitLine } from "@/lib/agency/split";

/** Кабинет агентства: раздел денег, изоляция фирм, чек-лист настройки, сводка. */
const IWAN = "a0000000-0000-4000-8000-000000000001"; // владелец OWO Ads
const OLA = "a0000000-0000-4000-8000-000000000002"; // сотрудник OWO Ads
const SERVICE = "a0000000-0000-4000-8000-000000000003"; // сервисный аккаунт OWO Ads
const CLIENT_OWNER = "a0000000-0000-4000-8000-000000000004"; // владелец фирмы клиента
const STRANGER = "a0000000-0000-4000-8000-000000000005"; // чужая фирма

let db: PGlite;
let agency: string;
let clientOrg: string;
let strangerOrg: string;
let client: string;

const createOrg = (user: string, name: string, slug: string, preset = "event-services") =>
  asUser(db, user, async () => {
    const r = await db.query<{ id: string }>("select public.create_organization($1,$2,$3) as id", [
      name,
      slug,
      preset,
    ]);
    return r.rows[0].id;
  });

async function newOrder(
  fields: Partial<{
    amount: number;
    costs: number;
    ad: number;
    soldBy: string | null;
    status: string;
    month: string;
    due: string | null;
    kind: string;
    title: string;
  }> = {},
) {
  const r = await asUser(db, IWAN, () =>
    db.query<{ id: string }>(
      `insert into public.agency_orders (organization_id, client_id, title, kind, amount_grosze,
         direct_costs_grosze, ad_budget_grosze, sold_by, period_month, status, paid_at, due_date)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9::date,$10, case when $10 = 'paid' then now() end, $11::date) returning id`,
      [
        agency,
        client,
        fields.title ?? "Landing page",
        fields.kind ?? "project",
        fields.amount ?? 100000,
        fields.costs ?? 0,
        fields.ad ?? 0,
        fields.soldBy === undefined ? IWAN : fields.soldBy,
        fields.month ?? "2026-11-01",
        fields.status ?? "draft",
        fields.due ?? null,
      ],
    ),
  );
  return r.rows[0].id;
}

const addWork = (order: string, user: string, hours: number) =>
  asUser(db, IWAN, () =>
    db.query(
      "insert into public.agency_order_work (organization_id, order_id, user_id, hours) values ($1,$2,$3,$4)",
      [agency, order, user, hours],
    ),
  );

const split = async (order: string, user = IWAN) =>
  (
    await asUser(db, user, () =>
      db.query<{ user_id: string | null; role: string; amount_grosze: number }>(
        "select user_id, role, amount_grosze::int as amount_grosze from public.agency_order_split($1,$2)",
        [agency, order],
      ),
    )
  ).rows;

const toLines = (rows: Awaited<ReturnType<typeof split>>): SplitLine[] =>
  rows.map((r) => ({
    userId: r.user_id,
    role: r.role as SplitLine["role"],
    amountGrosze: r.amount_grosze,
  }));

beforeAll(async () => {
  db = await createTestDb();
  for (const id of [IWAN, OLA, SERVICE, CLIENT_OWNER, STRANGER]) await createUser(db, id);
  agency = await createOrg(IWAN, "OWO Ads", "owo-ads", "agency");
  clientOrg = await createOrg(IWAN, "Klient Sp. z o.o.", "klient");
  strangerOrg = await createOrg(STRANGER, "Obca firma", "obca");
  await db.query(
    "insert into public.memberships (organization_id, user_id, role) values ($1,$2,'member'), ($1,$3,'admin')",
    [agency, OLA, SERVICE],
  );
  client = (
    await asUser(db, IWAN, () =>
      db.query<{ id: string }>(
        "insert into public.agency_clients (organization_id, name, status, client_org_id) values ($1,'Klient',$2,$3) returning id",
        [agency, "active", clientOrg],
      ),
    )
  ).rows[0].id;
});
afterAll(() => db.close());

describe("воронка агентства", () => {
  it("у агентства свои этапы, у Barowo — прежние", async () => {
    const keys = async (org: string) =>
      (
        await db.query<{ key: string }>(
          "select key from public.pipeline_stages where organization_id=$1 order by position",
          [org],
        )
      ).rows.map((r) => r.key);
    expect(await keys(agency)).toEqual([
      "new",
      "contacted",
      "meeting",
      "offer_sent",
      "client",
      "rejected",
      "spam",
    ]);
    expect(await keys(clientOrg)).toContain("deposit_paid");
  });
});

describe("раздел денег по заказу", () => {
  it("10 / 25 / 65: продавец, компания и исполнители по часам, сумма = база до гроша", async () => {
    const order = await newOrder({ amount: 100001, costs: 0 });
    await addWork(order, IWAN, 1);
    await addWork(order, OLA, 2);
    const rows = await split(order);
    const total = rows.reduce((s, r) => s + r.amount_grosze, 0);
    expect(total).toBe(100001);
    expect(rows.find((r) => r.role === "sale")).toMatchObject({
      user_id: IWAN,
      amount_grosze: 10000,
    });
    // 65 % от 100001 = 65000 (вниз); 1/3 и 2/3 часов.
    expect(rows.filter((r) => r.role === "work").map((r) => [r.user_id, r.amount_grosze])).toEqual([
      [IWAN, 21666],
      [OLA, 43333],
    ]);
    // Остатки округления уходят компании.
    expect(rows.find((r) => r.role === "company")?.amount_grosze).toBe(
      100001 - 10000 - 21666 - 43333,
    );
  });

  it("суммы с остатками сходятся до гроша и совпадают с TypeScript-расчётом", async () => {
    const cases = [
      { amount: 1, costs: 0, hours: [0.25] },
      { amount: 99999, costs: 333, hours: [1.33, 2.5, 0.17] },
      { amount: 1234567, costs: 7654, hours: [7, 7, 7] },
      { amount: 500000, costs: 500000, hours: [3] },
    ];
    for (const c of cases) {
      const order = await newOrder({ amount: c.amount, costs: c.costs });
      const people = [IWAN, OLA, SERVICE];
      for (const [i, h] of c.hours.entries()) await addWork(order, people[i], h);
      const rows = await split(order);
      expect(rows.reduce((s, r) => s + r.amount_grosze, 0)).toBe(c.amount - c.costs);
      const ts = splitOrder({
        amountGrosze: c.amount,
        directCostsGrosze: c.costs,
        sellers: [{ userId: IWAN, shareBp: 10000 }],
        work: c.hours.map((h, i) => ({ userId: people[i], hours: h })),
      });
      expect(toLines(rows)).toEqual(ts);
    }
  });

  it("нет часов → 65 % видны строкой «не распределено», а не уходят компании", async () => {
    const order = await newOrder({ amount: 200000 });
    const rows = await split(order);
    expect(rows.find((r) => r.role === "work")).toEqual({
      user_id: null,
      role: "work",
      amount_grosze: 130000,
    });
    expect(rows.find((r) => r.role === "company")?.amount_grosze).toBe(50000);
  });

  it("рекламный бюджет не влияет на раздел", async () => {
    const a = await newOrder({ amount: 300000, costs: 10000, ad: 0 });
    const b = await newOrder({ amount: 300000, costs: 10000, ad: 5000000 });
    const strip = (rows: Awaited<ReturnType<typeof split>>) =>
      rows.map((r) => [r.role, r.amount_grosze]);
    expect(strip(await split(b))).toEqual(strip(await split(a)));
  });

  it("продавец и исполнитель в одном лице получает обе строки (75 %)", async () => {
    const order = await newOrder({ amount: 100000 });
    await addWork(order, IWAN, 5);
    const mine = (await split(order)).filter((r) => r.user_id === IWAN);
    expect(mine.reduce((s, r) => s + r.amount_grosze, 0)).toBe(75000);
  });

  it("доли — параметр организации, формула их читает", async () => {
    await db.query(
      "update public.organizations set agency_share_sale_bp=2000, agency_share_company_bp=3000, agency_share_work_bp=5000 where id=$1",
      [agency],
    );
    const order = await newOrder({ amount: 100000 });
    const rows = await split(order);
    expect(rows.map((r) => r.amount_grosze)).toEqual([20000, 50000, 30000]);
    expect(toLines(rows)).toEqual(
      splitOrder(
        {
          amountGrosze: 100000,
          directCostsGrosze: 0,
          sellers: [{ userId: IWAN, shareBp: 10000 }],
          work: [],
        },
        { saleBp: 2000, companyBp: 3000, workBp: 5000 },
      ),
    );
    await expect(
      db.query("update public.organizations set agency_share_sale_bp=0 where id=$1", [agency]),
    ).rejects.toThrow();
    await db.query(
      "update public.organizations set agency_share_sale_bp=1000, agency_share_company_bp=2500, agency_share_work_bp=6500 where id=$1",
      [agency],
    );
  });

  it("исполнитель и продавец — только участники агентства", async () => {
    const order = await newOrder();
    await expect(addWork(order, STRANGER, 2)).rejects.toThrow(/not a member/);
    await expect(newOrder({ soldBy: STRANGER })).rejects.toThrow(/not a member/);
  });

  it("часы: больше 0 и не больше 500", async () => {
    const order = await newOrder();
    await expect(addWork(order, OLA, 0)).rejects.toThrow();
    await expect(addWork(order, OLA, 501)).rejects.toThrow();
  });
});

describe("изоляция фирм", () => {
  it("чужая организация ничего не видит и не может записать", async () => {
    const order = await newOrder();
    await asUser(db, STRANGER, async () => {
      for (const t of [
        "agency_clients",
        "agency_orders",
        "agency_order_work",
        "agency_setup_marks",
      ]) {
        const r = await db.query<{ n: number }>(`select count(*)::int as n from public.${t}`);
        expect(r.rows[0].n).toBe(0);
      }
      expect(
        (await db.query("select * from public.agency_order_split($1,$2)", [agency, order])).rows,
      ).toEqual([]);
      await expect(
        db.query("insert into public.agency_clients (organization_id, name) values ($1,'X')", [
          agency,
        ]),
      ).rejects.toThrow();
      await expect(
        db.query("select * from public.agency_setup_status($1)", [agency]),
      ).rejects.toThrow(/forbidden/);
      const s = await db.query<{ d: { clients: unknown[]; invoiced_grosze: number } }>(
        "select public.agency_summary($1) as d",
        [agency],
      );
      expect(s.rows[0].d.clients).toEqual([]);
    });
  });

  it("нельзя привязать клиента к фирме, в которой ты не состоишь", async () => {
    await expect(
      asUser(db, IWAN, () =>
        db.query(
          "insert into public.agency_clients (organization_id, name, client_org_id) values ($1,'Obcy',$2)",
          [agency, strangerOrg],
        ),
      ),
    ).rejects.toThrow(/not a member/);
  });
});

describe("чек-лист настройки", () => {
  const status = async (user = OLA) =>
    Object.fromEntries(
      (
        await asUser(db, user, () =>
          db.query<{ step_key: string; done_at: string | null }>(
            "select step_key, done_at from public.agency_setup_status($1,$2)",
            [agency, client],
          ),
        )
      ).rows.map((r) => [r.step_key, r.done_at !== null]),
    );

  it("автоматические шаги отмечаются по фактам в базе", async () => {
    let s = await status();
    expect(Object.keys(s)).toHaveLength(12);
    expect(s.org_created).toBe(true);
    // Сервисный доступ выдаётся сам: команда агентства — участники кабинета клиента (решение 038).
    expect(s.service_member).toBe(true);
    expect(s.owner_joined).toBe(false); // владелец фирмы клиента — Иван из OWO Ads, не считается

    await db.query(
      `insert into public.memberships (organization_id, user_id, role, is_service)
       values ($1,$2,'admin',true)
       on conflict (organization_id, user_id) do update set is_service = true`,
      [clientOrg, SERVICE],
    );
    const ch = await db.query<{ id: string }>(
      "insert into public.channels (organization_id, type, name) values ($1,'website','Strona') returning id",
      [clientOrg],
    );
    await db.query(
      "insert into public.intake_log (organization_id, channel_id, ok) values ($1,$2,false)",
      [clientOrg, ch.rows[0].id],
    );
    s = await status();
    expect(s.service_member).toBe(true);
    expect(s.intake_channel).toBe(true);
    expect(s.form_connected).toBe(false); // только ошибочная заявка

    await db.query(
      "insert into public.intake_log (organization_id, channel_id, ok) values ($1,$2,true)",
      [clientOrg, ch.rows[0].id],
    );
    await db.query(
      "insert into public.invitations (organization_id, token_hash, role) values ($1, repeat('a',64), 'owner')",
      [clientOrg],
    );
    await db.query(
      "insert into public.memberships (organization_id, user_id, role) values ($1,$2,'owner')",
      [clientOrg, CLIENT_OWNER],
    );
    s = await status();
    expect(s.form_connected && s.owner_invited && s.owner_joined).toBe(true);
  });

  it("ручная отметка возможна только у ручных шагов", async () => {
    await asUser(db, OLA, () =>
      db.query(
        "insert into public.agency_setup_marks (organization_id, client_id, step_key, done_by) values ($1,$2,'branding',$3)",
        [agency, client, OLA],
      ),
    );
    expect((await status()).branding).toBe(true);
    await expect(
      asUser(db, OLA, () =>
        db.query(
          "insert into public.agency_setup_marks (organization_id, client_id, step_key) values ($1,$2,'owner_joined')",
          [agency, client],
        ),
      ),
    ).rejects.toThrow(/automatically/);
  });
});

describe("клиент из лида и повтор абонементов", () => {
  it("кнопка на этапе «Klient» создаёт клиента один раз", async () => {
    const lead = (
      await db.query<{ id: string }>(
        "insert into public.leads (organization_id, client_name, email, event_city, stage_key) values ($1,'Studio Ola','ola@studio.pl','Gdańsk','client') returning id",
        [agency],
      )
    ).rows[0].id;
    const make = () =>
      asUser(db, OLA, () =>
        db.query<{ id: string }>("select public.agency_client_from_lead($1,$2) as id", [
          agency,
          lead,
        ]),
      ).then((r) => r.rows[0].id);
    const first = await make();
    expect(await make()).toBe(first);
    const row = await db.query<{ name: string; city: string; status: string }>(
      "select name, city, status from public.agency_clients where id=$1",
      [first],
    );
    expect(row.rows[0]).toEqual({ name: "Studio Ola", city: "Gdańsk", status: "active" });
  });

  it("абонементы прошлого месяца копируются черновиками вместе с часами, без дублей", async () => {
    const src = await newOrder({
      kind: "retainer",
      title: "Pakiet Start, październik",
      month: "2026-10-01",
      status: "paid",
      due: "2026-10-10",
    });
    await addWork(src, OLA, 4);
    const repeat = () =>
      asUser(db, IWAN, () =>
        db.query<{ n: number }>("select public.agency_repeat_retainers($1,'2026-11-01') as n", [
          agency,
        ]),
      ).then((r) => r.rows[0].n);
    expect(await repeat()).toBe(1);
    expect(await repeat()).toBe(0);
    const copy = await db.query<{ id: string; title: string; status: string; due_date: string }>(
      "select id, title, status, due_date::text from public.agency_orders where repeated_from=$1",
      [src],
    );
    expect(copy.rows[0]).toMatchObject({
      title: "Pakiet Start, listopad",
      status: "draft",
      due_date: "2026-11-10",
    });
    const hours = await db.query<{ hours: string }>(
      "select hours::text from public.agency_order_work where order_id=$1",
      [copy.rows[0].id],
    );
    expect(hours.rows).toEqual([{ hours: "4.00" }]);
  });
});

describe("сводка за месяц", () => {
  it("раздел + прямые расходы = Получено, до гроша", async () => {
    const month = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Warsaw" })
      .format(new Date())
      .slice(0, 7);
    const order = await newOrder({
      amount: 777777,
      costs: 12345,
      status: "paid",
      month: `${month}-01`,
    });
    await addWork(order, OLA, 3);
    await newOrder({ amount: 50000, status: "invoiced", month: `${month}-01`, due: "2020-01-01" });
    const d = (
      await asUser(db, IWAN, () =>
        db.query<{
          d: {
            received_grosze: number;
            overdue_grosze: number;
            direct_costs_grosze: number;
            split: { amount_grosze: number }[];
            clients: { id: string; month_grosze: number }[];
          };
        }>("select public.agency_summary($1,$2) as d", [agency, `${month}-01`]),
      )
    ).rows[0].d;
    const splitTotal = d.split.reduce((s, x) => s + Number(x.amount_grosze), 0);
    expect(splitTotal + Number(d.direct_costs_grosze)).toBe(Number(d.received_grosze));
    expect(Number(d.overdue_grosze)).toBeGreaterThanOrEqual(50000);
    expect(d.clients.find((c) => c.id === client)).toBeTruthy();
  });
});
