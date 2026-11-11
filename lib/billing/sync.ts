import type { Database, Queryable } from "@/lib/db/core";
import { t, type MessageKey } from "@/lib/i18n";
import { MODULES, isModuleKey, type ModuleKey } from "./modules";
import { calculatePrice, type Price, type PriceLine } from "./pricing";
import { StripeError, stripeRequest, type StripeConfig } from "./stripe";

/**
 * Абонемент бизнеса ↔ Stripe. Решение 022.
 *
 * Как растёт сумма: модули/места поменялись → calculatePrice → строки подписки Stripe
 * обновляются (subscription items с price_data). Если сумма выросла — Stripe сразу выставляет
 * доплату за остаток месяца (proration_behavior = always_invoice) и списывает её с карты;
 * если уменьшилась — разница уходит в кредит на следующий счёт (create_prorations).
 *
 * Все функции работают «от сервиса» (без RLS): права проверяет вызывающий код.
 */

const LINE_LABEL: Record<PriceLine["key"], MessageKey> = {
  leads: "billing.modules.leads",
  channels: "billing.modules.channels",
  documents: "billing.modules.documents",
  payments: "billing.modules.payments",
  calendar: "billing.modules.calendar",
  bundle: "billing.modules.bundle",
  seats: "billing.modules.seats",
};

export type BillingState = {
  organizationId: string;
  name: string;
  nip: string | null;
  email: string | null;
  modules: ModuleKey[];
  seats: number;
  adClient: boolean;
  discountBp: number;
  customerId: string | null;
  subscriptionId: string | null;
  status: string;
  monthlyNetGrosze: number;
};

export async function loadBillingState(tx: Queryable, org: string): Promise<BillingState | null> {
  const { rows } = await tx.query<{
    name: string;
    nip: string | null;
    email: string | null;
    modules: string[];
    seats: number;
    ad_client: boolean | null;
    discount_bp: number | null;
    billing_email: string | null;
    stripe_customer_id: string | null;
    stripe_subscription_id: string | null;
    status: string | null;
    monthly_net_grosze: number | null;
  }>(
    `select o.name, o.nip, o.email,
       coalesce((select array_agg(m.module order by m.module) from public.organization_modules m
                 where m.organization_id = o.id), '{}') as modules,
       public.billable_seats(o.id) as seats,
       b.ad_client, b.discount_bp, b.billing_email, b.stripe_customer_id, b.stripe_subscription_id,
       b.status, b.monthly_net_grosze
     from public.organizations o left join public.organization_billing b on b.organization_id = o.id
     where o.id = $1`,
    [org],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    organizationId: org,
    name: r.name,
    nip: r.nip,
    email: r.billing_email ?? r.email,
    modules: r.modules.filter(isModuleKey),
    seats: Number(r.seats),
    adClient: r.ad_client ?? false,
    discountBp: r.discount_bp ?? 0,
    customerId: r.stripe_customer_id,
    subscriptionId: r.stripe_subscription_id,
    status: r.status ?? "none",
    monthlyNetGrosze: Number(r.monthly_net_grosze ?? 0),
  };
}

export function priceOf(state: BillingState): Price {
  return calculatePrice({
    modules: state.modules,
    seats: Math.max(1, state.seats),
    adClient: state.adClient,
    discountBp: state.discountBp,
  });
}

// ───────── Продукты и строки подписки ─────────

const productId = (key: PriceLine["key"]) => `owo_crm_${key}`;
const knownProducts = new Set<string>();

/** Продукт на каждую строку цены с постоянным id (owo_crm_documents): создаём один раз. */
async function ensureProduct(config: StripeConfig, key: PriceLine["key"]) {
  const id = productId(key);
  if (knownProducts.has(id)) return id;
  try {
    await stripeRequest(config, "GET", `/v1/products/${id}`);
  } catch (error) {
    if (!(error instanceof StripeError) || error.status !== 404) throw error;
    await stripeRequest(config, "POST", "/v1/products", {
      id,
      name: `OWO CRM — ${t(LINE_LABEL[key])}`,
      tax_code: "txcd_10103001", // SaaS для бизнеса (нужно только Stripe Tax)
    });
  }
  knownProducts.add(id);
  return id;
}

async function priceData(config: StripeConfig, line: PriceLine) {
  return {
    currency: "pln",
    product: await ensureProduct(config, line.key),
    unit_amount: line.unitGrosze,
    recurring: { interval: "month" },
    tax_behavior: "exclusive",
  };
}

function taxParams(config: StripeConfig) {
  if (config.automaticTax) return { automatic_tax: { enabled: true } };
  if (config.taxRateId) return { default_tax_rates: [config.taxRateId] };
  return {};
}

async function ensureCustomer(db: Database, config: StripeConfig, state: BillingState) {
  if (state.customerId) return state.customerId;
  const customer = await stripeRequest<{ id: string }>(
    config,
    "POST",
    "/v1/customers",
    {
      name: state.name,
      email: state.email ?? undefined,
      preferred_locales: ["pl"],
      metadata: { organization_id: state.organizationId },
      // NIP клиента — на счёте Stripe (eu_vat с префиксом PL).
      tax_id_data: state.nip ? [{ type: "eu_vat", value: `PL${state.nip}` }] : undefined,
    },
    `customer-${state.organizationId}`,
  );
  await db.query(
    `insert into public.organization_billing (organization_id, stripe_customer_id) values ($1, $2)
     on conflict (organization_id) do update set stripe_customer_id = excluded.stripe_customer_id`,
    [state.organizationId, customer.id],
  );
  return customer.id;
}

type StripeSubscription = {
  id: string;
  status: string;
  metadata?: Record<string, string>;
  current_period_end?: number;
  items: {
    data: {
      id: string;
      metadata?: Record<string, string>;
      price?: { product?: string };
      current_period_end?: number;
    }[];
  };
};

export type SyncResult = { price: Price; mode: "local" | "stripe"; charged?: boolean };

/**
 * Пересчитать абонемент и, если есть подписка Stripe, обновить её строки.
 * Зовётся после смены модулей, скидки и при входе/удалении пользователя (места).
 */
export async function syncSubscription(
  db: Database,
  org: string,
  config: StripeConfig | null,
): Promise<SyncResult | null> {
  const state = await loadBillingState(db, org);
  if (!state) return null;
  const price = priceOf(state);
  await db.query(
    `insert into public.organization_billing (organization_id, monthly_net_grosze, billed_seats, synced_at)
     values ($1, $2, $3, now())
     on conflict (organization_id) do update set monthly_net_grosze = excluded.monthly_net_grosze,
       billed_seats = excluded.billed_seats, synced_at = now(), last_error = null`,
    [org, price.netGrosze, Math.max(1, state.seats)],
  );
  if (!config || !state.subscriptionId || state.status === "canceled")
    return { price, mode: "local" };

  try {
    const sub = await stripeRequest<StripeSubscription>(
      config,
      "GET",
      `/v1/subscriptions/${state.subscriptionId}`,
    );
    // Строка подписки узнаётся по продукту owo_crm_<ключ> (после Checkout метаданных у строк нет).
    const keyOf = (i: StripeSubscription["items"]["data"][number]) =>
      i.metadata?.line_key ?? (i.price?.product ?? "").replace(/^owo_crm_/, "");
    const existing = new Map(sub.items.data.map((i) => [keyOf(i), i.id] as const));
    const items: Record<string, unknown>[] = [];
    for (const line of price.lines) {
      const id = existing.get(line.key);
      existing.delete(line.key);
      items.push({
        ...(id ? { id } : {}),
        price_data: await priceData(config, line),
        quantity: line.quantity,
        metadata: { line_key: line.key },
      });
    }
    for (const id of existing.values()) items.push({ id, deleted: true });
    const charged = price.netGrosze > state.monthlyNetGrosze;
    await stripeRequest(config, "POST", `/v1/subscriptions/${state.subscriptionId}`, {
      items: items as never,
      // Рост — доплата сразу за остаток месяца; снижение — кредит на следующий счёт.
      proration_behavior: charged ? "always_invoice" : "create_prorations",
      ...taxParams(config),
    });
    return { price, mode: "stripe", charged };
  } catch (error) {
    await db.query(
      "update public.organization_billing set last_error = $2 where organization_id = $1",
      [org, (error as Error).message.slice(0, 500)],
    );
    throw error;
  }
}

/** Ссылка на первую оплату (Stripe Checkout): клиент вводит карту — дальше списания сами. */
export async function createCheckoutLink(
  db: Database,
  org: string,
  config: StripeConfig,
  siteUrl: string,
) {
  const state = await loadBillingState(db, org);
  if (!state) throw new Error("organization not found");
  const price = priceOf(state);
  const customer = await ensureCustomer(db, config, state);
  const lineItems = [];
  for (const line of price.lines)
    lineItems.push({
      price_data: await priceData(config, line),
      quantity: line.quantity,
      ...(config.taxRateId && !config.automaticTax ? { tax_rates: [config.taxRateId] } : {}),
    });
  const session = await stripeRequest<{ url: string }>(config, "POST", "/v1/checkout/sessions", {
    mode: "subscription",
    customer,
    client_reference_id: org,
    locale: "pl",
    line_items: lineItems as never,
    subscription_data: {
      metadata: { organization_id: org },
    },
    // Строки подписки помечаются ключом — по нему потом обновляются суммы.
    metadata: { organization_id: org, line_keys: price.lines.map((l) => l.key).join(",") },
    ...(config.automaticTax ? { automatic_tax: { enabled: true } } : {}),
    customer_update: config.automaticTax ? { address: "auto", name: "auto" } : undefined,
    success_url: `${siteUrl}/ustawienia/abonament?oplacono=1`,
    cancel_url: `${siteUrl}/ustawienia/abonament`,
  });
  await db.query(
    `insert into public.organization_billing (organization_id, monthly_net_grosze, status)
     values ($1, $2, 'incomplete')
     on conflict (organization_id) do update set monthly_net_grosze = excluded.monthly_net_grosze,
       status = case when organization_billing.status in ('none','canceled') then 'incomplete'
                     else organization_billing.status end`,
    [org, price.netGrosze],
  );
  return session.url;
}

/** Портал клиента Stripe: карта, счета, отмена. */
export async function createPortalLink(config: StripeConfig, customer: string, returnUrl: string) {
  const s = await stripeRequest<{ url: string }>(config, "POST", "/v1/billing_portal/sessions", {
    customer,
    return_url: returnUrl,
    locale: "pl",
  });
  return s.url;
}

// ───────── Вебхуки ─────────

export type StripeEvent = { id: string; type: string; data: { object: Record<string, unknown> } };

const SUB_STATUSES = [
  "incomplete",
  "trialing",
  "active",
  "past_due",
  "unpaid",
  "canceled",
  "paused",
];

async function orgBy(db: Queryable, sub?: unknown, customer?: unknown, meta?: unknown) {
  const metaOrg =
    meta && typeof meta === "object" ? (meta as Record<string, string>).organization_id : undefined;
  if (metaOrg) return metaOrg;
  const { rows } = await db.query<{ organization_id: string }>(
    `select organization_id from public.organization_billing
     where ($1::text is not null and stripe_subscription_id = $1) or ($2::text is not null and stripe_customer_id = $2)
     limit 1`,
    [typeof sub === "string" ? sub : null, typeof customer === "string" ? customer : null],
  );
  return rows[0]?.organization_id ?? null;
}

const idOf = (v: unknown) =>
  typeof v === "string" ? v : v && typeof v === "object" && "id" in v ? String(v.id) : null;

/** Комиссия Stripe по платежу счёта (из balance_transaction). Не нашли — 0. */
async function stripeFee(config: StripeConfig | null, invoice: Record<string, unknown>) {
  if (!config) return 0;
  try {
    let charge = idOf(invoice.charge);
    if (!charge && invoice.payment_intent) {
      const pi = await stripeRequest<{ latest_charge?: string }>(
        config,
        "GET",
        `/v1/payment_intents/${idOf(invoice.payment_intent)}`,
      );
      charge = pi.latest_charge ?? null;
    }
    if (!charge) return 0;
    const c = await stripeRequest<{ balance_transaction?: { fee?: number } }>(
      config,
      "GET",
      `/v1/charges/${charge}`,
      { expand: ["balance_transaction"] },
    );
    return c.balance_transaction?.fee ?? 0;
  } catch {
    return 0;
  }
}

function warsawMonth(unix: number) {
  const d = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Warsaw" }).format(
    new Date(unix * 1000),
  );
  return `${d.slice(0, 7)}-01`;
}

/**
 * Обработать событие Stripe один раз (журнал billing_events). Возвращает false для повтора.
 * invoice.paid → строка заказа в кабинете агентства (абонемент, оплачено, комиссия Stripe — прямой расход).
 */
export async function handleStripeEvent(
  db: Database,
  config: StripeConfig | null,
  event: StripeEvent,
) {
  return db.transaction(async (tx) => {
    const { rows } = await tx.query<{ id: string }>(
      "insert into public.billing_events (id, type) values ($1, $2) on conflict do nothing returning id",
      [event.id, event.type],
    );
    if (rows.length === 0) return false;
    const o = event.data.object;
    let org: string | null = null;

    if (event.type === "checkout.session.completed") {
      org = (o.client_reference_id as string) ?? (await orgBy(tx, null, o.customer, o.metadata));
      if (org && o.subscription)
        await tx.query(
          `insert into public.organization_billing (organization_id, stripe_customer_id, stripe_subscription_id, status)
           values ($1, $2, $3, 'active')
           on conflict (organization_id) do update set stripe_customer_id = excluded.stripe_customer_id,
             stripe_subscription_id = excluded.stripe_subscription_id, status = 'active'`,
          [org, idOf(o.customer), idOf(o.subscription)],
        );
    } else if (event.type.startsWith("customer.subscription.")) {
      org = await orgBy(tx, o.id, o.customer, o.metadata);
      const status = event.type === "customer.subscription.deleted" ? "canceled" : String(o.status);
      const items = (o.items as StripeSubscription["items"] | undefined)?.data ?? [];
      const periodEnd =
        (o.current_period_end as number | undefined) ?? items[0]?.current_period_end;
      if (org && SUB_STATUSES.includes(status))
        await tx.query(
          `insert into public.organization_billing (organization_id, stripe_customer_id, stripe_subscription_id, status, current_period_end)
           values ($1, $2, $3, $4, to_timestamp($5))
           on conflict (organization_id) do update set stripe_customer_id = excluded.stripe_customer_id,
             stripe_subscription_id = excluded.stripe_subscription_id, status = excluded.status,
             current_period_end = coalesce(excluded.current_period_end, organization_billing.current_period_end)`,
          [org, idOf(o.customer), o.id, status, periodEnd ?? null],
        );
    } else if (event.type === "invoice.paid" || event.type === "invoice.payment_failed") {
      const parent = o.parent as
        { subscription_details?: { subscription?: string; metadata?: unknown } } | undefined;
      const sub = idOf(o.subscription) ?? parent?.subscription_details?.subscription ?? null;
      org = await orgBy(
        tx,
        sub,
        o.customer,
        (o.subscription_details as { metadata?: unknown } | undefined)?.metadata ??
          parent?.subscription_details?.metadata,
      );
      if (org && event.type === "invoice.payment_failed") {
        await tx.query(
          "update public.organization_billing set status = 'past_due' where organization_id = $1",
          [org],
        );
      }
      const net = Number(o.subtotal_excluding_tax ?? o.subtotal ?? 0);
      if (org && event.type === "invoice.paid" && net > 0) {
        await recordInvoice(tx, config, org, o, net);
      }
    }
    await tx.query(
      "update public.billing_events set processed_at = now(), organization_id = $2 where id = $1",
      [event.id, org],
    );
    return true;
  });
}

async function recordInvoice(
  tx: Queryable,
  config: StripeConfig | null,
  org: string,
  invoice: Record<string, unknown>,
  net: number,
) {
  // Клиент агентства, к которому привязан этот бизнес (первый по времени).
  const { rows } = await tx.query<{ organization_id: string; id: string }>(
    "select organization_id, id from public.agency_clients where client_org_id = $1 order by created_at limit 1",
    [org],
  );
  const client = rows[0];
  if (!client) return;
  const lines =
    (invoice.lines as { data?: { period?: { start?: number } }[] } | undefined)?.data ?? [];
  const start =
    lines[0]?.period?.start ?? (invoice.period_start as number | undefined) ?? Date.now() / 1000;
  const month = warsawMonth(start);
  const paidAt =
    (invoice.status_transitions as { paid_at?: number } | undefined)?.paid_at ??
    Math.floor(Date.now() / 1000);
  const { rows: mods } = await tx.query<{ module: ModuleKey }>(
    "select module from public.organization_modules where organization_id = $1 order by module",
    [org],
  );
  const names = mods.map((m) => t(MODULES[m.module].labelKey)).join(" + ");
  const [y, m] = month.split("-").map(Number);
  const title = t("billing.invoice", {
    modules: names || t("billing.modules.leads"),
    month: `${t(`agency.months.${m}` as MessageKey)} ${y}`,
  }).slice(0, 200);
  const fee = Math.min(net, await stripeFee(config, invoice));
  // Услуга «CRM (abonament)» (system_key = 'crm'): 65 % — её ответственному (решение 027).
  await tx.query(
    `insert into public.agency_orders (organization_id, client_id, title, kind, amount_grosze, direct_costs_grosze,
       period_month, status, paid_at, stripe_invoice_id, note, service_id)
     values ($1, $2, $3, 'retainer', $4, $5, $6::date, 'paid', to_timestamp($7), $8, $9,
       (select s.id from public.agency_services s where s.organization_id = $1 and s.system_key = 'crm' and s.active))
     on conflict do nothing`,
    [
      client.organization_id,
      client.id,
      title,
      net,
      fee,
      month,
      paidAt,
      String(invoice.id),
      invoice.number ? `Stripe ${String(invoice.number)}` : null,
    ],
  );
}
