import type { NotificationKind } from "./email.ts";
import type { NotificationLead } from "./telegram.ts";
export type Delivery = {
  id: string;
  organization_id: string;
  lead_id: string;
  user_id: string;
  channel: "telegram" | "push" | "email";
  kind: NotificationKind;
  payment_id: string | null;
  lease_token: string;
  attempts: number;
  created_at: string;
};
export type QueueRepository = {
  prepare(): Promise<void>;
  claim(leadId?: string): Promise<Delivery[]>;
  eligible(delivery: Delivery): Promise<NotificationLead | null>;
  finish(delivery: Delivery, outcome: "sent" | "skipped" | "failed", error?: string): Promise<void>;
};
export type DeliverySender = (
  delivery: Delivery,
  lead: NotificationLead,
) => Promise<"sent" | "skipped">;
/** Atomic SQL claiming prevents concurrent workers sending the same queued job. */
export async function runNotificationBatch(
  repository: QueueRepository,
  sender: DeliverySender,
  options: { enabled?: boolean; leadId?: string } = {},
) {
  if (!options.enabled) return { processed: 0, disabled: true };
  if (!options.leadId) await repository.prepare();
  const jobs = await repository.claim(options.leadId);
  const results = await Promise.allSettled(
    jobs.map(async (job) => {
      let outcome: "sent" | "skipped" | "failed";
      let code: string | undefined;
      try {
        const lead = await repository.eligible(job);
        outcome = lead ? await sender(job, lead) : "skipped";
      } catch {
        outcome = "failed";
        code = "provider_failed";
      }
      // A failed final write keeps the lease until expiry; never claim it immediately a second time.
      await repository.finish(job, outcome, code);
    }),
  );
  return {
    processed: jobs.length,
    failedWrites: results.filter((result) => result.status === "rejected").length,
    disabled: false,
  };
}
