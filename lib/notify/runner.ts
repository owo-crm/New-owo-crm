import "server-only";
import { getDb } from "@/lib/db";
import { createQueueRepository } from "./queue-repository";
import { createDeliverySender } from "./delivery-sender";
import { runNotificationBatch } from "./queue";
import { deliveryConfig } from "./config";

/** Один проход очереди уведомлений (вместо Supabase Edge Function `notify` + pg_cron). */
export async function runNotifications(leadId?: string) {
  const db = getDb();
  const config = deliveryConfig((key) => process.env[key]);
  const repository = createQueueRepository(db);
  if (!config.enabled) {
    if (!leadId) await repository.prepare(); // уборка журнала и сессий всё равно нужна
    return { processed: 0, disabled: true };
  }
  return runNotificationBatch(repository, createDeliverySender(db, config), {
    enabled: true,
    leadId,
  });
}
