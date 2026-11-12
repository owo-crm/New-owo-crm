import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, createTestDb, createUser } from "./harness";
import { splitOrder } from "@/lib/agency/split";

/** Правила распределения из документа партнёров (docs/agency-distribution.md). */
const NIKON = "e0000000-0000-4000-8000-000000000001";
const IVAN = "e0000000-0000-4000-8000-000000000002";
const ARTEM = "e0000000-0000-4000-8000-000000000003";
let db: PGlite;
let org: string;
let client: string;

const q = <T>(sql: string, params: unknown[] = []) =>
  asUser(db, IVAN, () => db.query<T>(sql, params)).then((r) => r.rows);
const month = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Warsaw" }).format(new Date()).slice(0, 7) +
  "-01";

async function order(amount: number, status = "paid") {
  return (
    await q<{ id: string }>(
      `insert into public.agency_orders (organization_id, client_id, title, kind, amount_grosze, period_month, status, paid_at)
       values ($1,$2,'Projekt','project',$3,$4::date,$5, case when $5='paid' then now() end) returning id`,
      [org, client, amount, month(), status],
    )
  )[0].id;
}
const split = (id: string) =>
  q<{ user_id: string | null; role: string; amount_grosze: number }>(
    "select user_id, role, amount_grosze::int as amount_grosze from public.agency_order_split($1,$2)",
    [org, id],
  );

beforeAll(async () => {
  db = await createTestDb();
  for (const id of [NIKON, IVAN, ARTEM]) await createUser(db, id);
  org = (
    await asUser(db, IVAN, () =>
      db.query<{ id: string }>(
        "select public.create_organization('OWO Ads','owo-dist','agency') as id",
      ),
    )
  ).rows[0].id;
  await db.query(
    "insert into public.memberships (organization_id, user_id, role) values ($1,$2,'admin'),($1,$3,'member')",
    [org, NIKON, ARTEM],
  );
  const lead = (
    await db.query<{ id: string }>(
      "insert into public.leads (organization_id, client_name, email, source_label) values ($1,'Studio','s@x.pl','Instagram') returning id",
      [org],
    )
  ).rows[0].id;
  client = (
    await q<{ id: string }>("select public.agency_client_from_lead($1,$2) as id", [org, lead])
  )[0].id;
});
afterAll(() => db.close());

describe("распределение по документу партнёров", () => {
  it("пример из документа: 25 000 zł без расходов → 2 500 / 6 250 / 16 250", async () => {
    const id = await order(2_500_000);
    await q(
      "insert into public.agency_order_sellers (organization_id, order_id, user_id, share_bp) values ($1,$2,$3,10000)",
      [org, id, ARTEM],
    );
    // Часы примера: Nikon 53, Ivan 93 в одном заказе. В документе 4 575 / 11 325 посчитаны по проектам
    // отдельно; здесь один проект — пропорция 53/146 от 16 250 zł.
    await q(
      "insert into public.agency_order_work (organization_id, order_id, user_id, hours) values ($1,$2,$3,53),($1,$2,$4,93)",
      [org, id, NIKON, IVAN],
    );
    const rows = await split(id);
    expect(rows.find((r) => r.role === "sale")).toEqual({
      user_id: ARTEM,
      role: "sale",
      amount_grosze: 250_000,
    });
    const work = Object.fromEntries(
      rows.filter((r) => r.role === "work").map((r) => [r.user_id, r.amount_grosze]),
    );
    expect(Math.round(work[NIKON] / 100)).toBe(5899); // 16 250 × 53/146
    expect(work[NIKON] + work[IVAN] + rows.find((r) => r.role === "company")!.amount_grosze).toBe(
      2_250_000,
    );
  });

  it("два продавца делят 10 % по долям; непокрытая доля видна как нераспределённая", async () => {
    const id = await order(100_000);
    await q(
      "insert into public.agency_order_sellers (organization_id, order_id, user_id, share_bp) values ($1,$2,$3,5000),($1,$2,$4,3000)",
      [org, id, ARTEM, IVAN],
    );
    const rows = await split(id);
    expect(rows.filter((r) => r.role === "sale")).toEqual([
      { user_id: ARTEM, role: "sale", amount_grosze: 5000 },
      { user_id: IVAN, role: "sale", amount_grosze: 3000 },
      { user_id: null, role: "sale", amount_grosze: 2000 },
    ]);
    expect(rows.reduce((s, r) => s + r.amount_grosze, 0)).toBe(100_000);
    // TypeScript-копия формулы даёт то же самое.
    expect(
      splitOrder({
        amountGrosze: 100_000,
        directCostsGrosze: 0,
        sellers: [
          { userId: ARTEM, shareBp: 5000 },
          { userId: IVAN, shareBp: 3000 },
        ],
        work: [],
      }).map((l) => [l.userId, l.role, l.amountGrosze]),
    ).toEqual(rows.map((r) => [r.user_id, r.role, r.amount_grosze]));
  });

  it("расходы строками: сумма = прямые расходы заказа, логистика Artem — его деньги, не из 65 %", async () => {
    const id = await order(300_000);
    await q(
      "insert into public.agency_order_costs (organization_id, order_id, label, amount_grosze, paid_to) values ($1,$2,'Transport sprzętu',20000,$3),($1,$2,'Druk',10000,null)",
      [org, id, ARTEM],
    );
    const o = await q<{ d: number }>(
      "select direct_costs_grosze::int as d from public.agency_orders where id=$1",
      [id],
    );
    expect(o[0].d).toBe(30000);
    expect((await split(id)).reduce((s, r) => s + r.amount_grosze, 0)).toBe(270_000);
    await expect(
      q(
        "insert into public.agency_order_costs (organization_id, order_id, label, amount_grosze, paid_to) values ($1,$2,'X',1,$3)",
        [org, id, "e0000000-0000-4000-8000-0000000000ff"],
      ),
    ).rejects.toThrow();
  });

  it("сводка: фонд 25 % минус расходы фонда, выплаты, логистика и доход по источнику лида", async () => {
    await q(
      "insert into public.agency_fund_expenses (organization_id, spent_on, category, label, amount_grosze) values ($1,current_date,'equipment','Statyw',120000)",
      [org],
    );
    await q(
      "insert into public.agency_payouts (organization_id, user_id, period_month, amount_grosze) values ($1,$2,$3::date,50000)",
      [org, NIKON, month()],
    );
    const d = (
      await q<{
        d: {
          fund: { month_in: number; month_out: number; balance: number };
          payouts: { user_id: string; amount_grosze: number }[];
          costs_to_people: { user_id: string; amount_grosze: number }[];
          by_source: { source: string; amount_grosze: number }[];
        };
      }>("select public.agency_summary($1) as d", [org])
    )[0].d;
    expect(Number(d.fund.month_out)).toBe(120000);
    expect(Number(d.fund.balance)).toBe(Number(d.fund.month_in) - 120000);
    expect(d.payouts).toEqual([{ user_id: NIKON, amount_grosze: 50000 }]);
    expect(d.costs_to_people).toEqual([{ user_id: ARTEM, amount_grosze: 20000 }]);
    expect(d.by_source[0].source).toBe("Instagram");
  });

  it("услуга: 65 % целиком ответственному, вклад Artem увеличивает сальдо фонда", async () => {
    const service = (
      await q<{ id: string }>(
        "insert into public.agency_services (organization_id, name, owner_id, kind) values ($1,'Strona www',$2,'project') returning id",
        [org, NIKON],
      )
    )[0].id;
    await q(
      "insert into public.agency_client_services (organization_id, client_id, service_id) values ($1,$2,$3)",
      [org, client, service],
    );
    const id = await order(350_000);
    await q("update public.agency_orders set service_id=$2 where id=$1", [id, service]);
    const work = (await split(id)).filter((r) => r.role === "work");
    expect(work).toEqual([{ user_id: NIKON, role: "work", amount_grosze: 227_500 }]);
    const before = (
      await q<{ d: { fund: { balance: number } } }>("select public.agency_summary($1) as d", [org])
    )[0].d;
    await q(
      "insert into public.agency_fund_contributions (organization_id, user_id, contributed_on, amount_grosze) values ($1,$2,current_date,750000)",
      [org, ARTEM],
    );
    const after = (
      await q<{ d: { fund: { balance: number } } }>("select public.agency_summary($1) as d", [org])
    )[0].d;
    expect(Number(after.fund.balance) - Number(before.fund.balance)).toBe(750_000);
  });
});
