import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, createTestDb, createUser } from "./harness";
import { TYPE_PARSERS, type Database } from "@/lib/db/core";
import { ensureAgencyWorkspace } from "@/lib/db/bootstrap";
import { syncSubscription } from "@/lib/billing/sync";

/**
 * Абонемент после отказа от Stripe (D-23): сумма считается локально, оплата — вне платформы,
 * заказ «CRM (abonament)» агентство вносит вручную. История Stripe остаётся в базе и в отчётах.
 */
const ADMIN = "c0000000-0000-4000-8000-000000000001";
const OWNER = "c0000000-0000-4000-8000-000000000002";
const WORKER = "c0000000-0000-4000-8000-000000000003";

let pg: PGlite;
let db: Database;
let agency: string;
let org: string;
let client: string;
let crmService: string;

const month = (offset = 0) => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offset, 1))
    .toISOString()
    .slice(0, 10);
};
const asAdmin = <T>(sql: string, params: unknown[] = []) =>
  asUser(pg, ADMIN, () => pg.query<T>(sql, params)).then((r) => r.rows);
const billingRow = async () =>
  (
    await pg.query<{
      monthly_net_grosze: number;
      billed_seats: number;
      stripe_customer_id: string | null;
      stripe_subscription_id: string | null;
      status: string;
    }>(
      `select monthly_net_grosze::int, billed_seats, stripe_customer_id, stripe_subscription_id, status
         from public.organization_billing where organization_id=$1`,
      [org],
    )
  ).rows[0];
const orderCount = async () =>
  (await pg.query<{ n: number }>("select count(*)::int as n from public.agency_orders")).rows[0].n;

beforeAll(async () => {
  pg = await createTestDb();
  const parsers = Object.fromEntries(Object.entries(TYPE_PARSERS).map(([k, v]) => [Number(k), v]));
  const wrap = (x: { query: PGlite["query"] }) => ({
    query: (sql: string, params?: unknown[]) => x.query(sql, params, { parsers }) as never,
  });
  db = { ...wrap(pg), transaction: (fn) => pg.transaction((tx) => fn(wrap(tx as never))) };
  for (const id of [ADMIN, OWNER, WORKER]) await createUser(pg, id);
  await pg.query("update auth.users set is_platform_admin=true where id=$1", [ADMIN]);
  agency = (await ensureAgencyWorkspace(db, {}, () => {}))!;
  org = (
    await asUser(pg, ADMIN, () =>
      pg.query<{ id: string }>("select public.create_organization('Foto','foto') as id"),
    )
  ).rows[0].id;
  await pg.query("update public.memberships set is_service=true where organization_id=$1", [org]);
  await pg.query(
    "insert into public.memberships (organization_id, user_id, role) values ($1,$2,'owner')",
    [org, OWNER],
  );
  client = (
    await pg.query<{ id: string }>(
      "insert into public.agency_clients (organization_id, name, client_org_id, status) values ($1,'Foto',$2,'active') returning id",
      [agency, org],
    )
  ).rows[0].id;
  await pg.query(
    "delete from public.organization_modules where organization_id=$1 and module<>'leads'",
    [org],
  );
  // История Stripe (до D-23): идентификаторы и статус подписки остаются в базе.
  await pg.query(
    "insert into public.organization_billing (organization_id, stripe_customer_id, stripe_subscription_id, status, monthly_net_grosze) values ($1,'cus_1','sub_1','active',3900)",
    [org],
  );
  crmService = (
    await pg.query<{ id: string }>(
      "select id from public.agency_services where organization_id=$1 and system_key='crm'",
      [agency],
    )
  ).rows[0].id;
});
afterAll(() => pg.close());

describe("абонемент считается локально, без Stripe", () => {
  it("пересчёт по модулям: сумма в базе, история Stripe не трогается, заказы не создаются", async () => {
    const before = await orderCount();
    await pg.query(
      "insert into public.organization_modules (organization_id, module) values ($1,'documents')",
      [org],
    );
    const r = await syncSubscription(db, org);
    expect(r).toMatchObject({ mode: "local" });
    expect(r?.price.netGrosze).toBe(9800); // 39 + 59
    expect(await billingRow()).toMatchObject({
      monthly_net_grosze: 9800,
      stripe_customer_id: "cus_1",
      stripe_subscription_id: "sub_1",
      status: "active",
    });
    expect(await orderCount()).toBe(before);
  });

  it("места и скидка считаются без Stripe", async () => {
    await pg.query(
      "insert into public.memberships (organization_id, user_id, role) values ($1,$2,'member')",
      [org, WORKER],
    );
    let r = await syncSubscription(db, org);
    // Обслуживающий аккаунт OWO не платное место: owner + worker = 2 → +15 zł за второго.
    expect(r?.price.lines.find((l) => l.key === "seats")?.totalGrosze).toBe(1500);
    expect((await billingRow()).billed_seats).toBe(2);
    await pg.query(
      "update public.organization_billing set discount_bp=1000 where organization_id=$1",
      [org],
    );
    r = await syncSubscription(db, org);
    expect(r?.price.netGrosze).toBe(Math.floor((9800 + 1500) * 0.9));
  });
});

describe("заказы «CRM (abonament)» — вручную", () => {
  it("ручной заказ услуги CRM: 65 % — ответственному за услугу, раздел как раньше", async () => {
    const [{ id }] = await asAdmin<{ id: string }>(
      `insert into public.agency_orders (organization_id, client_id, title, kind, amount_grosze, period_month, status, paid_at, service_id)
       values ($1,$2,'CRM: abonament','retainer',10000,$3::date,'paid',now(),$4) returning id`,
      [agency, client, month(-1), crmService],
    );
    const split = await asAdmin<{ role: string; amount_grosze: number; user_id: string | null }>(
      "select role, amount_grosze::int, user_id from public.agency_order_split($1,$2) order by role",
      [agency, id],
    );
    expect(split.find((s) => s.role === "work")).toMatchObject({
      amount_grosze: 6500,
      user_id: ADMIN,
    });
    expect(split.find((s) => s.role === "company")?.amount_grosze).toBe(2500);
  });

  it("«Powtórz abonamenty» копирует абонемент прошлого месяца черновиком", async () => {
    const [{ n }] = await asAdmin<{ n: number }>(
      "select public.agency_repeat_retainers($1,$2::date) as n",
      [agency, month(0)],
    );
    expect(n).toBe(1);
    const [draft] = await asAdmin<{
      status: string;
      amount_grosze: number;
      stripe_invoice_id: string | null;
    }>(
      "select status, amount_grosze::int, stripe_invoice_id from public.agency_orders where organization_id=$1 and period_month=$2::date",
      [agency, month(0)],
    );
    expect(draft).toEqual({ status: "draft", amount_grosze: 10000, stripe_invoice_id: null });
  });

  it("старые заказы из Stripe остаются и видны в сводке как «Abonament CRM»", async () => {
    await pg.query(
      `insert into public.agency_orders (organization_id, client_id, title, kind, amount_grosze, direct_costs_grosze,
         period_month, status, paid_at, stripe_invoice_id, service_id)
       values ($1,$2,'CRM: abonament (Stripe)','retainer',3900,172,$3::date,'paid',now(),'in_hist',$4)`,
      [agency, client, month(0), crmService],
    );
    const [{ d }] = await asAdmin<{
      d: { by_source: { source: string; amount_grosze: number }[]; direct_costs_grosze: number };
    }>("select public.agency_summary($1,$2::date) as d", [agency, month(0)]);
    expect(d.by_source).toContainEqual(
      expect.objectContaining({ source: "Abonament CRM", amount_grosze: 3900 }),
    );
    expect(d.direct_costs_grosze).toBe(172);
  });
});
