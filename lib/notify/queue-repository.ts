import { one, type Queryable } from "../db/core.ts";
import type { Delivery, QueueRepository } from "./queue.ts";
import type { NotificationLead } from "./telegram.ts";
/** Очередь доставок; работает от имени сервиса (владелец базы), каждый вызов — отдельная транзакция. */
export function createQueueRepository(db: Queryable): QueueRepository {
  return {
    async prepare() {
      await db.query("select public.prepare_notification_jobs()");
    },
    async claim(leadId) {
      const { rows } = await db.query<Delivery>(
        "select * from public.claim_notification_jobs($1)",
        [leadId ?? null],
      );
      return rows;
    },
    async eligible(delivery) {
      const [lead, settings, member] = await Promise.all([
        one<
          NotificationLead & {
            first_response_at: string | null;
            stage_key: string;
            created_at: string;
          }
        >(
          db,
          `select id,client_name,phone_e164,email,event_type,event_date,event_city,guests,message,source_label,
             first_response_at,stage_key,created_at
           from public.leads where organization_id=$1 and id=$2 and deleted_at is null`,
          [delivery.organization_id, delivery.lead_id],
        ),
        one<{ enabled: boolean; events: string[] }>(
          db,
          "select enabled,events from public.notification_settings where organization_id=$1 and user_id=$2 and channel=$3",
          [delivery.organization_id, delivery.user_id, delivery.channel],
        ),
        one<{ role: string }>(
          db,
          "select role from public.memberships where organization_id=$1 and user_id=$2",
          [delivery.organization_id, delivery.user_id],
        ),
      ]);
      if (!lead || !settings?.enabled || !settings.events.includes(delivery.kind) || !member)
        return null;
      if (delivery.kind === "new_lead" && Date.now() - Date.parse(delivery.created_at) > 86400000)
        return null;
      if (delivery.kind !== "new_lead") {
        if (
          Date.now() - Date.parse(lead.created_at) > 7 * 86400000 ||
          (delivery.kind === "unanswered_15m" &&
            Date.now() - Date.parse(lead.created_at) >= 7200000) ||
          lead.first_response_at ||
          (delivery.kind === "unanswered_2h" && !["owner", "admin"].includes(member.role))
        )
          return null;
        const stage = await one<{ kind: string }>(
          db,
          "select kind from public.pipeline_stages where organization_id=$1 and key=$2",
          [delivery.organization_id, lead.stage_key],
        );
        if (stage?.kind !== "open") return null;
      }
      return lead;
    },
    async finish(delivery, outcome, errorCode) {
      const row = await one<{ ok: boolean }>(
        db,
        "select public.finish_notification_job($1,$2,$3,$4) as ok",
        [delivery.id, delivery.lease_token, outcome, errorCode ?? null],
      );
      if (row?.ok !== true) throw new Error("notification_write_failed");
    },
  };
}
