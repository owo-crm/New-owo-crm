import "server-only";
import { getDb } from "@/lib/db";
import { syncSubscription } from "./sync";

/**
 * Пересчитать абонемент бизнеса «в фоне»: после входа нового пользователя, удаления участника,
 * смены модулей. Только локальный расчёт (D-23); ошибка не ломает действие пользователя.
 */
export async function resyncBilling(organizationId: string) {
  try {
    return await syncSubscription(getDb(), organizationId);
  } catch (error) {
    console.error("[billing] sync", organizationId, (error as Error).message);
    return null;
  }
}
