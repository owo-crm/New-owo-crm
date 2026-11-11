import "server-only";
import { getDb } from "@/lib/db";
import { stripeConfig } from "./stripe";
import { syncSubscription } from "./sync";

/**
 * Пересчитать абонемент бизнеса «в фоне»: после входа нового пользователя, удаления участника,
 * смены модулей. Ошибка Stripe не ломает действие пользователя — она пишется в
 * organization_billing.last_error и видна агентству в карточке клиента.
 */
export async function resyncBilling(organizationId: string) {
  try {
    return await syncSubscription(getDb(), organizationId, stripeConfig());
  } catch (error) {
    console.error("[billing] sync", organizationId, (error as Error).message);
    return null;
  }
}
