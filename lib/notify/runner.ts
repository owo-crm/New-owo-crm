import "server-only";
import { getDb } from "@/lib/db";
import { createQueueRepository } from "./queue-repository";
import { createDeliverySender } from "./delivery-sender";
import { runNotificationBatch } from "./queue";
import { deliveryConfig } from "./config";
import { vapidKeys } from "./vapid";

/** Один проход очереди уведомлений (вместо Supabase Edge Function `notify` + pg_cron). */
export async function runNotifications(leadId?: string) {
  const db = getDb();
  const vapid = await vapidKeys();
  const config = {
    ...deliveryConfig((key) => process.env[key]),
    vapidPublicKey: vapid.publicKey,
    vapidPrivateKey: vapid.privateKey,
    vapidSubject: vapid.subject,
  };
  const repository = createQueueRepository(db);
  // Расходы рекламы: раз в сутки на аккаунт (внутри стоит проверка «20+ часов»), без ключей — ничего.
  if (!leadId) {
    const { syncAdAccounts } = await import("@/lib/ads/sync");
    await syncAdAccounts(db, process.env).catch((error) =>
      console.error("[ads]", (error as Error).message),
    );
  }
  // Рассылки едут той же минутной очередью, но НЕ зависят от OUTBOUND_NOTIFICATIONS_ENABLED:
  // это письма клиентам через почту фирмы, а не уведомления команде. Раньше они стояли после
  // выключателя уведомлений — и при выключенных уведомлениях кампании не уходили никогда.
  if (!leadId) {
    const { runMailingQueue } = await import("@/lib/mailing/sender");
    await runMailingQueue(siteOrigin()).catch((error) =>
      console.error("[mailing]", (error as Error).message),
    );
    // Входящие письма, у которых не удалось сразу забрать текст из Resend.
    const { retryPendingBodies } = await import("@/lib/mail/inbox");
    await retryPendingBodies(db).catch((error) =>
      console.error("[inbox]", (error as Error).message),
    );
  }
  if (!config.enabled) {
    if (!leadId) await repository.prepare(); // уборка журнала и сессий всё равно нужна
    return { processed: 0, disabled: true };
  }
  const result = await runNotificationBatch(repository, createDeliverySender(db, config), {
    enabled: true,
    leadId,
  });
  return result;
}

export function siteOrigin() {
  return process.env.NEXT_PUBLIC_SITE_URL || process.env.SITE_URL || "http://localhost:3000";
}
