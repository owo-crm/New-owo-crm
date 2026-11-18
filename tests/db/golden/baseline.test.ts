import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, createTestDb, createUser } from "../harness";

/**
 * M0 — golden-тесты (docs/architecture/OWO_CRM_MIGRATION_PLAN.md, M0).
 *
 * Фиксируют ТЕКУЩИЕ результаты отчётных SQL-функций на постоянном наборе данных, чтобы любая
 * миграция M1–M9 сразу показала расхождение. Тест ничего не проверяет «по смыслу»: снимок —
 * это базовая точка, включая известные странности (они перечислены в docs/architecture/M0_REPORT.md
 * и здесь НЕ исправляются).
 *
 * Детерминизм: все даты фикстур считаются от начала текущего месяца по Варшаве (M0, M-1, …),
 * а в снимке даты заменены на «M{смещение}» / «M{смещение}/dДД», UUID — на имена фикстур.
 * Поэтому снимок не зависит от дня запуска. Обновлять снимок (`vitest -u`) — только осознанно,
 * с объяснением в отчёте этапа.
 */

const OWNER = "a0000000-0000-4000-8000-000000000001";
const MEMBER = "a0000000-0000-4000-8000-000000000002";
const NIKON = "a0000000-0000-4000-8000-000000000011";
const IVAN = "a0000000-0000-4000-8000-000000000012";
const ARTEM = "a0000000-0000-4000-8000-000000000013";

const L = (n: number) => `b0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const NAMES: Record<string, string> = {
  [OWNER]: "OWNER",
  [MEMBER]: "MEMBER",
  [NIKON]: "NIKON",
  [IVAN]: "IVAN",
  [ARTEM]: "ARTEM",
};
for (let i = 1; i <= 20; i++) NAMES[L(i)] = `LEAD_${i}`;

let db: PGlite;
let ev: string; // кабинет «event-services» (как Barowo)
let ag: string; // кабинет агентства
let monthStart: Date; // 1-е число текущего месяца, Варшава (полночь UTC этой даты)

/** «M-2/d25» → дата YYYY-MM-DD; смещение в месяцах от текущего. */
function d(offset: number, day: number) {
  const x = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + offset, day));
  return x.toISOString().slice(0, 10);
}
/** Метка времени: дата + 10:00 UTC (днём по Варшаве — без перехода через полночь). */
const ts = (offset: number, day: number) => `${d(offset, day)}T10:00:00Z`;

function monthOffset(y: number, m: number) {
  return (y - monthStart.getUTCFullYear()) * 12 + (m - 1 - monthStart.getUTCMonth());
}
const sign = (n: number) => (n >= 0 ? `+${n}` : String(n));

/** Заменяет даты на смещения от текущего месяца и UUID на имена — снимок не зависит от дня запуска. */
function normalize(value: unknown): unknown {
  if (value instanceof Date) {
    const iso = value.toISOString();
    // Колонки date приходят как полночь UTC — сохраняем день; timestamptz — только месяц.
    return normalize(iso.endsWith("T00:00:00.000Z") ? iso.slice(0, 10) : iso);
  }
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, normalize(v)]),
    );
  if (typeof value !== "string") return value;
  if (NAMES[value]) return NAMES[value];
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)) return "<uuid>";
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (m) return `M${sign(monthOffset(+m[1], +m[2]))}/d${m[3]}`;
  m = /^(\d{4})-(\d{2})$/.exec(value);
  if (m) return `M${sign(monthOffset(+m[1], +m[2]))}`;
  m = /^(\d{4})-(\d{2})-(\d{2})[T ]\d{2}:\d{2}/.exec(value);
  // Метки времени: только месяц — у созданных через now() день и время случайны.
  if (m) return `M${sign(monthOffset(+m[1], +m[2]))}`;
  return value;
}

const as = <T>(user: string, sql: string, params: unknown[] = []) =>
  asUser(db, user, () => db.query<T>(sql, params)).then((r) => r.rows);

beforeAll(async () => {
  db = await createTestDb();
  const ym = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Warsaw" })
    .format(new Date())
    .slice(0, 7);
  monthStart = new Date(`${ym}-01T00:00:00Z`);
  for (const id of [OWNER, MEMBER, NIKON, IVAN, ARTEM]) await createUser(db, id);

  // ── Кабинет мероприятий (воронка Barowo) ──────────────────────────────
  ev = (
    await as<{ id: string }>(
      OWNER,
      "select public.create_organization('Event Co','golden-ev') as id",
    )
  )[0].id;
  await db.query(
    "insert into public.memberships (organization_id, user_id, role) values ($1,$2,'member')",
    [ev, MEMBER],
  );
  const lead = (
    n: number,
    name: string,
    stage: string,
    created: string,
    extra: Partial<{
      phone: string;
      email: string;
      event: string | null;
      type: string;
      city: string;
      source: string;
      utm: string;
      responded: string | null;
      next: string | null;
      deleted: boolean;
    }> = {},
  ) =>
    db.query(
      `insert into public.leads (id, organization_id, client_name, phone_e164, email, stage_key, created_at,
         updated_at, event_date, event_type, event_city, source_label, utm, first_response_at, next_contact_at, deleted_at)
       values ($1,$2,$3,$4,$5,$6,$7,$7,$8,$9,$10,$11,$12,$13,$14, case when $15 then $7::timestamptz end)`,
      [
        L(n),
        ev,
        name,
        extra.phone ?? null,
        extra.email ?? `${name.toLowerCase().replace(/\s/g, "")}@example.com`,
        stage,
        created,
        extra.event ?? null,
        extra.type ?? "Wesele",
        extra.city ?? "Gdańsk",
        extra.source ?? "Strona",
        extra.utm ? JSON.stringify({ campaign: extra.utm }) : "{}",
        extra.responded ?? null,
        extra.next ?? null,
        extra.deleted ?? false,
      ],
    );
  await lead(1, "Anna Nowak", "new", ts(0, 2), {
    phone: "+48500000001",
    event: d(2, 14),
    utm: "Wesela jesień",
  });
  await lead(2, "Anna Nowak", "contract_signed", ts(-1, 5), {
    phone: "+48500000001",
    event: d(1, 20),
    responded: ts(-1, 5),
    source: "Instagram",
  });
  await lead(3, "Jan Kowalski", "contacted", ts(0, 3), {
    phone: "+48500000003",
    event: d(3, 7),
    responded: ts(0, 3),
    next: ts(0, 1),
    utm: "wesela jesień",
  });
  await lead(4, "Ola Lis", "contract_sent", ts(-2, 25), {
    phone: "+48500000004",
    event: d(4, 9),
    responded: ts(-2, 25),
    type: "Urodziny",
    source: "Facebook",
  });
  await lead(5, "Piotr Zieliński", "deposit_paid", ts(-1, 12), {
    phone: "+48500000005",
    event: d(1, 3),
    responded: ts(-1, 12),
    source: "Facebook",
    utm: "Firmowe",
  });
  await lead(6, "Spam Bot", "spam", ts(0, 4), { source: "Strona" });
  await lead(7, "Ewa Stara", "rejected", ts(-5, 25), { event: d(-4, 2) });
  await lead(8, "Usunięty", "new", ts(0, 5), { deleted: true });
  await lead(9, "Kasia Minione", "contract_signed", ts(-5, 25), {
    phone: "+48500000009",
    event: d(-1, 15),
    responded: ts(-5, 25),
  });
  await lead(10, "Bez Daty", "offer_sent", ts(0, 6), {
    phone: "+48500000010",
    responded: ts(0, 6),
  });

  // Платежи (как график из договора): оплачено, просрочено, впереди.
  await db.query(
    `insert into public.lead_payments (organization_id, lead_id, kind, label, amount_grosze, due_date, paid_at, position) values
     ($1,$2,'deposit','Zaliczka rezerwacyjna',50000,$4,$5,0),
     ($1,$2,'deposit','Druga zaliczka',100000,$6,null,1),
     ($1,$2,'balance','Wynagrodzenie końcowe',750000,$7,null,2),
     ($1,$3,'deposit','Zaliczka rezerwacyjna',50000,$8,$9,0),
     ($1,$3,'balance','Wynagrodzenie końcowe',300000,$10,null,1)`,
    [ev, L(2), L(5), d(-1, 5), ts(-1, 6), d(0, 10), d(1, 20), d(-1, 12), ts(0, 2), d(-1, 28)],
  );
  await db.query(
    `insert into public.documents (organization_id, lead_id, kind, number, snapshot, created_at) values
     ($1,$2,'contract','7/2026','{"price":9000}',$3),($1,$4,'contract','8/2026','{"price":3500}',$5)`,
    [ev, L(2), ts(-1, 6), L(5), ts(-1, 13)],
  );

  // Реклама: ручной аккаунт и Meta, расходы в текущем месяце.
  const acc = (
    await db.query<{ id: string }>(
      `insert into public.ad_accounts (organization_id, platform, external_id, name) values
       ($1,'manual',null,'Ręcznie'),($1,'meta','act_1','Meta') returning id`,
      [ev],
    )
  ).rows;
  await db.query(
    `insert into public.ad_spend (organization_id, ad_account_id, date, campaign_id, campaign_name, spend_grosze, impressions, clicks, platform_leads) values
     ($1,$2,$4,'m1','Wesela jesień',30000,5000,120,3),
     ($1,$3,$5,'c2','Firmowe',15000,2000,40,1),
     ($1,$3,$6,'c3','Bez zapytań',5000,900,10,0),
     ($1,$3,$7,'c2','Firmowe',99900,1,1,0)`,
    [ev, acc[0].id, acc[1].id, d(0, 1), d(0, 2), d(0, 3), d(-1, 20)],
  );

  // ── Кабинет агентства ──────────────────────────────────────────────────
  ag = (
    await as<{ id: string }>(
      IVAN,
      "select public.create_organization('OWO Ads','golden-ag','agency') as id",
    )
  )[0].id;
  await db.query(
    "insert into public.memberships (organization_id, user_id, role) values ($1,$2,'admin'),($1,$3,'member')",
    [ag, NIKON, ARTEM],
  );
  await db.query(
    "insert into public.leads (id, organization_id, client_name, email, source_label, stage_key, created_at) values ($1,$2,'Studio','studio@x.pl','Instagram','client',$3)",
    [L(20), ag, ts(-1, 3)],
  );
  const client = (
    await as<{ id: string }>(IVAN, "select public.agency_client_from_lead($1,$2) as id", [
      ag,
      L(20),
    ])
  )[0].id;
  const order = async (
    amount: number,
    status: string,
    month: number,
    paidDay: number | null,
    costs = 0,
  ) =>
    (
      await as<{ id: string }>(
        IVAN,
        `insert into public.agency_orders (organization_id, client_id, title, kind, amount_grosze, direct_costs_grosze,
           ad_budget_grosze, period_month, status, due_date, paid_at)
         values ($1,$2,'Zlecenie','project',$3,$4,200000,$5::date,$6,$7::date,$8) returning id`,
        [
          ag,
          client,
          amount,
          costs,
          d(month, 1),
          status,
          d(month, 20),
          paidDay ? ts(month, paidDay) : null,
        ],
      )
    )[0].id;
  const o1 = await order(1_000_000, "paid", 0, 5);
  await as(
    IVAN,
    "insert into public.agency_order_sellers (organization_id, order_id, user_id, share_bp) values ($1,$2,$3,10000)",
    [ag, o1, ARTEM],
  );
  await as(
    IVAN,
    "insert into public.agency_order_work (organization_id, order_id, user_id, hours) values ($1,$2,$3,60),($1,$2,$4,40)",
    [ag, o1, NIKON, IVAN],
  );
  const o2 = await order(333_333, "paid", 0, 6);
  await as(
    IVAN,
    "insert into public.agency_order_costs (organization_id, order_id, label, amount_grosze, paid_to) values ($1,$2,'Transport',33333,$3),($1,$2,'Druk',10000,null)",
    [ag, o2, ARTEM],
  );
  await order(500_000, "invoiced", 0, null);
  await order(250_000, "invoiced", -1, null);
  await order(100_000, "draft", 0, null);
  await order(400_000, "paid", -1, 10);
  await as(
    IVAN,
    "insert into public.agency_fund_expenses (organization_id, spent_on, category, label, amount_grosze) values ($1,$2,'software','Railway',12000)",
    [ag, d(0, 3)],
  );
  await as(
    IVAN,
    "insert into public.agency_payouts (organization_id, user_id, period_month, amount_grosze, paid_at) values ($1,$2,$3,50000,$4)",
    [ag, NIKON, d(0, 1), ts(0, 7)],
  );
});
afterAll(() => db.close());

const snap = (rows: unknown) => expect(normalize(rows)).toMatchSnapshot();

describe("M0 golden — кабинет мероприятий", () => {
  it("work_queue (Pulpit)", async () => {
    const r = await as<{ data: unknown }>(OWNER, "select public.work_queue($1,$2,$3) as data", [
      ev,
      OWNER,
      ts(0, 15),
    ]);
    snap(r[0].data);
  });
  it("dashboard_charts (Pulpit, графики)", async () => {
    snap(
      (await as<{ data: unknown }>(OWNER, "select public.dashboard_charts($1) as data", [ev]))[0]
        .data,
    );
  });
  it("calendar_events (Kalendarz)", async () => {
    snap(
      await as(OWNER, "select * from public.calendar_events($1,$2,$3)", [ev, d(-12, 1), d(13, 1)]),
    );
  });
  it("clients_list (Klienci)", async () => {
    snap(
      await as(
        OWNER,
        "select * from public.clients_list($1,null) order by client_name, person_key",
        [ev],
      ),
    );
  });
  it("contracts_list (Umowy)", async () => {
    snap(await as(OWNER, "select * from public.contracts_list($1,null)", [ev]));
  });
  it("finance_summary (Statystyka) — текущий и прошлый месяц", async () => {
    for (const m of [0, -1])
      snap(
        (
          await as<{ data: unknown }>(OWNER, "select public.finance_summary($1,$2) as data", [
            ev,
            d(m, 1),
          ])
        )[0].data,
      );
  });
  it("ads_report (Reklama) — текущий месяц", async () => {
    snap(
      (
        await as<{ data: unknown }>(OWNER, "select public.ads_report($1,$2,$3) as data", [
          ev,
          d(0, 1),
          d(1, 1),
        ])
      )[0].data,
    );
  });
  it("агрегаты платежей по организации (база M1.5 и M3)", async () => {
    snap(
      await as(
        OWNER,
        `select count(*)::int as n, sum(amount_grosze)::bigint as total,
                coalesce(sum(amount_grosze) filter (where paid_at is not null),0)::bigint as paid
           from public.lead_payments where organization_id = $1`,
        [ev],
      ),
    );
  });
});

describe("M0 golden — кабинет агентства", () => {
  it("agency_summary — текущий и прошлый месяц", async () => {
    for (const m of [0, -1])
      snap(
        (
          await as<{ d: unknown }>(IVAN, "select public.agency_summary($1,$2) as d", [ag, d(m, 1)])
        )[0].d,
      );
  });
  it("agency_order_split по каждому оплаченному заказу", async () => {
    const orders = await as<{ id: string; amount_grosze: number }>(
      IVAN,
      "select id, amount_grosze::int from public.agency_orders where organization_id=$1 and status='paid' order by amount_grosze",
      [ag],
    );
    const out = [];
    for (const o of orders)
      out.push({
        amount: o.amount_grosze,
        split: await as(
          IVAN,
          "select user_id, role, amount_grosze::bigint from public.agency_order_split($1,$2) order by role, user_id nulls first",
          [ag, o.id],
        ),
      });
    snap(out);
  });
  it("заказы и выплаты агентства по месяцам (база M1.5)", async () => {
    snap(
      await as(
        IVAN,
        `select to_char(period_month,'YYYY-MM') as month, status, count(*)::int as n, sum(amount_grosze)::bigint as total
           from public.agency_orders where organization_id=$1 group by 1,2 order by 1,2`,
        [ag],
      ),
    );
    snap(
      await as(
        IVAN,
        "select to_char(period_month,'YYYY-MM') as month, user_id, sum(amount_grosze)::bigint as total from public.agency_payouts where organization_id=$1 group by 1,2",
        [ag],
      ),
    );
  });
});
