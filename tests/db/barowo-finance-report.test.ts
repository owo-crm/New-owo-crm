import { afterAll, beforeAll, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, createTestDb, createUser } from "./harness";
import { TYPE_PARSERS, type Database } from "@/lib/db/core";
import { barowoFinanceReport } from "@/lib/platform/barowo-finance-report";

/** M1.5: финансовый отчёт по Barowo — только чтение, предложения по правилам владельца. */
const ADMIN = "f2000000-0000-4000-8000-000000000001";
const IVAN = "f2000000-0000-4000-8000-000000000002";
let pg: PGlite;
let db: Database;
let agency: string;
let barowo: string;
let client: string;

const month = (offset: number) => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offset, 1))
    .toISOString()
    .slice(0, 10);
};

beforeAll(async () => {
  pg = await createTestDb();
  const parsers = Object.fromEntries(Object.entries(TYPE_PARSERS).map(([k, v]) => [Number(k), v]));
  const wrap = (x: { query: PGlite["query"] }) => ({
    query: (sql: string, params?: unknown[]) => x.query(sql, params, { parsers }) as never,
  });
  db = { ...wrap(pg), transaction: (fn) => pg.transaction((tx) => fn(wrap(tx as never))) };
  for (const id of [ADMIN, IVAN]) await createUser(pg, id, id === IVAN ? "Ivan" : "Admin");
  await pg.query("update auth.users set is_platform_admin=true where id=$1", [ADMIN]);
  agency = (
    await asUser(pg, ADMIN, () =>
      pg.query<{ id: string }>("select public.create_organization('OWO Ads','owo','agency') as id"),
    )
  ).rows[0].id;
  barowo = (
    await asUser(pg, IVAN, () =>
      pg.query<{ id: string }>("select public.create_organization('Barowo','barowo') as id"),
    )
  ).rows[0].id;
  // Как в продакшне после M1.3: связь service + старая строка agency_clients.
  await pg.query(
    "insert into public.platform_managed_orgs (agency_org_id, org_id, relation) values ($1,$2,'service')",
    [agency, barowo],
  );
  client = (
    await pg.query<{ id: string }>(
      "insert into public.agency_clients (organization_id, name, client_org_id, status) values ($1,'Barowo',$2,'active') returning id",
      [agency, barowo],
    )
  ).rows[0].id;
  const ins = (status: string, m: number, amount: number, stripe: string | null) =>
    pg.query(
      `insert into public.agency_orders (organization_id, client_id, title, kind, amount_grosze, direct_costs_grosze,
         period_month, status, paid_at, stripe_invoice_id)
       values ($1,$2,'CRM: abonament','retainer',$3,$4,$5::date,$6, case when $6='paid' then now() end,$7)`,
      [agency, client, amount, stripe ? 172 : 0, month(m), status, stripe],
    );
  await ins("paid", -1, 3900, "in_1");
  await ins("invoiced", 0, 3900, null);
  await ins("draft", 0, 3900, null);
  await pg.query(
    "insert into public.agency_payouts (organization_id, user_id, period_month, amount_grosze) values ($1,$2,$3::date,1000)",
    [agency, ADMIN, month(-1)],
  );
});
afterAll(() => pg.close());

it("фактическая картина и предложения; ничего не меняется", async () => {
  const snapshot = async () =>
    (
      await pg.query<{ s: string }>(
        `select string_agg(status||':'||amount_grosze, ',' order by created_at)
                ||'|'||(select count(*) from public.agency_payouts)
                ||'|'||(select count(*) from public.audit_log) as s
           from public.agency_orders`,
      )
    ).rows[0].s;
  const before = await snapshot();
  const r = await barowoFinanceReport(db);
  expect(await snapshot()).toBe(before);

  expect(r.organization?.name).toBe("Barowo");
  expect(r.relation).toBe("service");
  expect(r.totals).toMatchObject({ orders: 3, paid_grosze: 3900, paid_from_stripe_grosze: 3900 });
  expect(r.totals.by_status).toMatchObject({
    paid: { n: 1, grosze: 3900 },
    invoiced: { n: 1 },
    draft: { n: 1 },
  });
  const by = (s: string) => r.orders.find((o) => o.status === s)!;
  expect(by("draft").proposal).toMatch(/Anulować/);
  expect(by("invoiced").proposal).toMatch(/realna faktura/);
  expect(by("paid").proposal).toMatch(/Zachować bez zmian/);
  expect(by("paid").closed_period).toBe(true);
  expect(by("paid").split.length).toBeGreaterThan(0);
  expect(by("paid").payouts_in_month).toEqual([{ user: "Admin", amount_grosze: 1000 }]);
  expect(r.totals.company_fund_grosze).toBeGreaterThan(0);
  expect(r.months[0]).toMatchObject({
    barowo_paid_grosze: 3900,
    share_pct: 100,
    payouts_grosze: 1000,
  });
});
