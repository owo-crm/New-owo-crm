import { createEmailPacer } from "./pacing.ts";
import { Bot } from "grammy";
import { one, type Queryable } from "../db/core.ts";
import { sendTelegramLead } from "./telegram.ts";
import { sendPushLead, type StoredPushSubscription } from "./push.ts";
import { emailContent, sendEmailLead } from "./email.ts";
import { loadMailSettings, sendBusinessMail } from "../mail/service.ts";
import type { DeliverySender } from "./queue.ts";
export type DeliveryConfig = {
  enabled: boolean;
  siteUrl: string;
  telegramToken?: string;
  vapidPublicKey?: string;
  vapidPrivateKey?: string;
  vapidSubject?: string;
  resendKey?: string;
  emailFrom?: string;
};
export function createDeliverySender(db: Queryable, config: DeliveryConfig): DeliverySender {
  const paceEmail = createEmailPacer();
  return async (delivery, lead) => {
    if (!config.enabled) return "skipped";
    if (delivery.channel === "telegram") {
      if (!config.telegramToken) throw new Error("telegram_not_configured");
      const link = await one<{ chat_id: string | null }>(
        db,
        "select chat_id::text from public.telegram_links where organization_id=$1 and user_id=$2",
        [delivery.organization_id, delivery.user_id],
      );
      if (!link?.chat_id) return "skipped";
      await sendTelegramLead(
        new Bot(config.telegramToken, { client: { timeoutSeconds: 5 } }),
        lead,
        String(link.chat_id),
        config.siteUrl,
        true,
        delivery.kind,
      );
      return "sent";
    }
    if (delivery.channel === "email") {
      const recipient = await one<{ email: string }>(
        db,
        "select email from auth.users where id=$1",
        [delivery.user_id],
      );
      if (!recipient?.email || !recipient.email.includes("@")) return "skipped"; // login bez e-maila
      // Почта фирмы (решение 035) — если настроена; иначе общий Resend платформы.
      if (await loadMailSettings(db, delivery.organization_id)) {
        const content = emailContent(lead, config.siteUrl, delivery.kind);
        await sendBusinessMail(
          db,
          delivery.organization_id,
          {
            to: [recipient.email],
            subject: content.subject,
            text: content.text,
            html: content.html,
          },
          { kind: "notification", leadId: lead.id },
        );
        return "sent";
      }
      if (!config.resendKey || !config.emailFrom) throw new Error("email_not_configured");
      await paceEmail();
      await sendEmailLead({
        lead,
        recipient: recipient.email,
        from: config.emailFrom,
        apiKey: config.resendKey,
        deliveryId: delivery.id,
        siteUrl: config.siteUrl,
        kind: delivery.kind,
        enabled: true,
      });
      return "sent";
    }
    if (!config.vapidPublicKey || !config.vapidPrivateKey || !config.vapidSubject)
      throw new Error("push_not_configured");
    const subscriptions = await db.query<StoredPushSubscription & { id: string }>(
      "select id,endpoint,keys from public.push_subscriptions where organization_id=$1 and user_id=$2",
      [delivery.organization_id, delivery.user_id],
    );
    const result = await Promise.all(
      subscriptions.rows.map(async (sub) => {
        const response = await sendPushLead(
          sub,
          lead,
          config.siteUrl,
          {
            subject: config.vapidSubject!,
            publicKey: config.vapidPublicKey!,
            privateKey: config.vapidPrivateKey!,
          },
          true,
          undefined,
          delivery.kind,
        );
        if (response.status === "expired") {
          await db.query(
            "delete from public.push_subscriptions where organization_id=$1 and user_id=$2 and id=$3",
            [delivery.organization_id, delivery.user_id, sub.id],
          );
        }
        return response.status;
      }),
    );
    return result.includes("sent") ? "sent" : "skipped";
  };
}
