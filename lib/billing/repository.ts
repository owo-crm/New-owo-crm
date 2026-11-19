import "server-only";
import { getDb } from "@/lib/db";
import { loadBillingState, priceOf } from "./sync";

/**
 * Чтение абонемента для экранов. Вызывать ТОЛЬКО после проверки прав
 * (агентство обслуживает бизнес / пользователь — его участник): читаем без RLS.
 */
export async function getBillingView(org: string) {
  const db = getDb();
  const state = await loadBillingState(db, org);
  if (!state) return null;
  const { rows: requests } = await db.query<{ module: string }>(
    "select module from public.module_requests where organization_id=$1 and handled_at is null order by created_at",
    [org],
  );
  return { state, price: priceOf(state), requests: requests.map((r) => r.module) };
}
export type BillingView = NonNullable<Awaited<ReturnType<typeof getBillingView>>>;
