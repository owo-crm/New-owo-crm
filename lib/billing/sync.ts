import type { Database, Queryable } from "@/lib/db/core";
import { isModuleKey, type ModuleKey } from "./modules";
import { calculatePrice, type Price } from "./pricing";

/**
 * Абонемент бизнеса — локальный учёт (решения 022, D-23). Сумма считается в приложении по модулям
 * и местам и хранится в organization_billing. Оплата — вне платформы.
 * Исторические поля прежней платёжной системы в organization_billing здесь не читаются.
 * Функции работают «от сервиса» (без RLS): права проверяет вызывающий код.
 */

export type BillingState = {
  organizationId: string;
  name: string;
  nip: string | null;
  email: string | null;
  modules: ModuleKey[];
  seats: number;
  adClient: boolean;
  discountBp: number;
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
    monthly_net_grosze: number | null;
  }>(
    `select o.name, o.nip, o.email,
       coalesce((select array_agg(m.module order by m.module) from public.organization_modules m
                 where m.organization_id = o.id), '{}') as modules,
       public.billable_seats(o.id) as seats,
       b.ad_client, b.discount_bp, b.billing_email, b.monthly_net_grosze
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

export type SyncResult = { price: Price; mode: "local" };

/**
 * Пересчитать абонемент локально: сумма по модулям, местам, скидке и «klient reklamy» пишется в
 * organization_billing. Зовётся после смены модулей/скидки и при входе/удалении пользователя.
 * Внешних платёжных систем нет (D-23): оплата — вне платформы, заказ «CRM (abonament)»
 * агентство вносит вручную.
 */
export async function syncSubscription(db: Database, org: string): Promise<SyncResult | null> {
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
  return { price, mode: "local" };
}
