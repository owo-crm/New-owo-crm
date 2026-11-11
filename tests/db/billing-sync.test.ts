import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, createTestDb, createUser } from "./harness";
import { TYPE_PARSERS, type Database } from "@/lib/db/core";
import { ensureAgencyWorkspace } from "@/lib/db/bootstrap";
import { handleStripeEvent, syncSubscription } from "@/lib/billing/sync";
import type { StripeConfig } from "@/lib/billing/stripe";

/** Абонемент ↔ Stripe без сети: fetch подменён, проверяем, что и с какими суммами уходит. */
const ADMIN = "c0000000-0000-4000-8000-000000000001";
const OWNER = "c0000000-0000-4000-8000-000000000002";
const WORKER = "c0000000-0000-4000-8000-000000000003";

let pg: PGlite;
let db: Database;
let agency: string;
let org: string;
const calls: { method: string; url: string; body: string }[] = [];

const fakeFetch: typeof fetch = async (input, init) => {
  const url = String(input);
  const method = init?.method ?? "GET";
  calls.push({ method, url, body: decodeURIComponent(String(init?.body ?? "")) });
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
  if (url.includes("/v1/products/")) return json({ id: url.split("/").pop() });
  if (method === "GET" && url.includes("/v1/subscriptions/sub_1"))
    return json({
      id: "sub_1",
      status: "active",
      items: { data: [{ id: "si_leads", price: { product: "owo_crm_leads" } }] },
    });
  if (url.includes("/v1/subscriptions/sub_1")) return json({ id: "sub_1" });
  if (url.includes("/v1/charges/ch_1")) return json({ balance_transaction: { fee: 172 } });
  return json({ error: { message: "not mocked" } }, 404);
};
const config: StripeConfig = {
  secretKey: "sk_test",
  taxRateId: "txr_vat23",
  automaticTax: false,
  fetchImpl: fakeFetch,
};

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
  await pg.query(
    "insert into public.agency_clients (organization_id, name, client_org_id) values ($1,'Foto',$2)",
    [agency, org],
  );
  await pg.query(
    "delete from public.organization_modules where organization_id=$1 and module<>'leads'",
    [org],
  );
  await pg.query(
    "insert into public.organization_billing (organization_id, stripe_customer_id, stripe_subscription_id, status, monthly_net_grosze) values ($1,'cus_1','sub_1','active',3900)",
    [org],
  );
});
afterAll(() => pg.close());

describe("сумма подписки растёт сама", () => {
  it("без Stripe — только пересчёт суммы в базе", async () => {
    const r = await syncSubscription(db, org, null);
    expect(r?.mode).toBe("local");
    expect(r?.price.netGrosze).toBe(3900);
  });

  it("включили модуль → строка добавлена, доплата сразу (always_invoice), VAT по ставке", async () => {
    await pg.query(
      "insert into public.organization_modules (organization_id, module) values ($1,'documents')",
      [org],
    );
    calls.length = 0;
    const r = await syncSubscription(db, org, config);
    expect(r).toMatchObject({ mode: "stripe", charged: true });
    expect(r?.price.netGrosze).toBe(9800);
    const update = calls.find(
      (c) => c.method === "POST" && c.url.endsWith("/v1/subscriptions/sub_1"),
    );
    expect(update?.body).toContain("items[0][id]=si_leads");
    expect(update?.body).toContain("items[1][price_data][product]=owo_crm_documents");
    expect(update?.body).toContain("items[1][price_data][unit_amount]=5900");
    expect(update?.body).toContain("proration_behavior=always_invoice");
    expect(update?.body).toContain("default_tax_rates[0]=txr_vat23");
    const b = await pg.query<{ monthly_net_grosze: number }>(
      "select monthly_net_grosze::int from public.organization_billing where organization_id=$1",
      [org],
    );
    expect(b.rows[0].monthly_net_grosze).toBe(9800);
  });

  it("новый пользователь → +15 zł строкой «места»; удалили модуль → кредит, не доплата", async () => {
    await pg.query(
      "insert into public.memberships (organization_id, user_id, role) values ($1,$2,'member')",
      [org, WORKER],
    );
    calls.length = 0;
    let r = await syncSubscription(db, org, config);
    expect(r?.price.lines.find((l) => l.key === "seats")?.totalGrosze).toBe(1500);
    await pg.query(
      "delete from public.organization_modules where organization_id=$1 and module='documents'",
      [org],
    );
    calls.length = 0;
    r = await syncSubscription(db, org, config);
    expect(r?.charged).toBe(false);
    const update = calls.find(
      (c) => c.method === "POST" && c.url.endsWith("/v1/subscriptions/sub_1"),
    );
    expect(update?.body).toContain("proration_behavior=create_prorations");
  });
});

describe("вебхук Stripe", () => {
  const paid = {
    id: "evt_paid_1",
    type: "invoice.paid",
    data: {
      object: {
        id: "in_1",
        number: "OWO-0001",
        customer: "cus_1",
        subscription: "sub_1",
        subtotal_excluding_tax: 9800,
        total: 12054,
        charge: "ch_1",
        status_transitions: { paid_at: 1_794_000_000 },
        lines: { data: [{ period: { start: 1_794_000_000 } }] },
      },
    },
  };

  it("оплата → заказ в кабинете агентства: netto, комиссия Stripe — прямой расход", async () => {
    expect(await handleStripeEvent(db, config, paid)).toBe(true);
    const o = await pg.query<{
      amount_grosze: number;
      direct_costs_grosze: number;
      status: string;
      kind: string;
      title: string;
    }>(
      "select amount_grosze::int, direct_costs_grosze::int, status, kind, title from public.agency_orders where stripe_invoice_id='in_1'",
    );
    expect(o.rows[0]).toMatchObject({
      amount_grosze: 9800,
      direct_costs_grosze: 172,
      status: "paid",
      kind: "retainer",
    });
    expect(o.rows[0].title).toMatch(/^CRM: /);
  });

  it("повтор того же события ничего не дублирует", async () => {
    expect(await handleStripeEvent(db, config, paid)).toBe(false);
    expect(await handleStripeEvent(db, config, { ...paid, id: "evt_paid_2" })).toBe(true);
    const n = await pg.query<{ n: number }>(
      "select count(*)::int as n from public.agency_orders where stripe_invoice_id='in_1'",
    );
    expect(n.rows[0].n).toBe(1);
  });

  it("неудачная оплата и отмена меняют статус", async () => {
    await handleStripeEvent(db, config, {
      id: "evt_fail",
      type: "invoice.payment_failed",
      data: { object: { id: "in_2", customer: "cus_1", subscription: "sub_1", subtotal: 9800 } },
    });
    const status = async () =>
      (
        await pg.query<{ status: string }>(
          "select status from public.organization_billing where organization_id=$1",
          [org],
        )
      ).rows[0].status;
    expect(await status()).toBe("past_due");
    await handleStripeEvent(db, config, {
      id: "evt_del",
      type: "customer.subscription.deleted",
      data: { object: { id: "sub_1", customer: "cus_1", status: "canceled", items: { data: [] } } },
    });
    expect(await status()).toBe("canceled");
  });
});
