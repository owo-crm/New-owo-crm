import "server-only";
import { getDb } from "@/lib/db";
import { stripeConfig } from "./stripe";
import { loadBillingState, priceOf } from "./sync";

/**
 * Чтение абонемента для экранов. Вызывать ТОЛЬКО после проверки прав
 * (агентство обслуживает бизнес / пользователь — его участник): читаем без RLS.
 */
export async function getBillingView(org: string) {
  const db = getDb();
  const state = await loadBillingState(db, org);
  if (!state) return null;
  const { rows } = await db.query<{
    status: string;
    current_period_end: string | null;
    last_error: string | null;
  }>(
    "select status, current_period_end, last_error from public.organization_billing where organization_id=$1",
    [org],
  );
  const { rows: requests } = await db.query<{ module: string }>(
    "select module from public.module_requests where organization_id=$1 and handled_at is null order by created_at",
    [org],
  );
  return {
    state,
    price: priceOf(state),
    status: rows[0]?.status ?? "none",
    periodEnd: rows[0]?.current_period_end ?? null,
    lastError: rows[0]?.last_error ?? null,
    requests: requests.map((r) => r.module),
    stripeEnabled: stripeConfig() !== null,
  };
}
export type BillingView = NonNullable<Awaited<ReturnType<typeof getBillingView>>>;
