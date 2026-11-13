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
  if (!config.enabled) {
    if (!leadId) await repository.prepare(); // уборка журнала и сессий всё равно нужна
    return { processed: 0, disabled: true };
  }
  const result = await runNotificationBatch(repository, createDeliverySender(db, config), {
    enabled: true,
    leadId,
  });
  // Рассылки едут той же минутной очередью: отдельный планировщик не нужен.
  if (!leadId) {
    const { runMailingQueue } = await import("@/lib/mailing/sender");
    await runMailingQueue(
      process.env.NEXT_PUBLIC_SITE_URL || process.env.SITE_URL || "http://localhost:3000",
    ).catch((error) => console.error("[mailing]", (error as Error).message));
  }
  return result;
}
