import webpush from "web-push";
import { z } from "zod";
import { t } from "../i18n.ts";
import { leadUrl, type NotificationLead } from "./telegram.ts";
const hosts = new Set([
  "fcm.googleapis.com",
  "web.push.apple.com",
  "updates.push.services.mozilla.com",
]);
export const pushSubscriptionSchema = z.object({
  endpoint: z
    .url()
    .max(2048)
    .refine((value) => {
      const url = new URL(value);
      return (
        url.protocol === "https:" &&
        !url.username &&
        !url.password &&
        (!url.port || url.port === "443") &&
        hosts.has(url.hostname)
      );
    }),
  keys: z.object({
    p256dh: z.string().regex(/^[A-Za-z0-9_-]{80,100}$/),
    auth: z.string().regex(/^[A-Za-z0-9_-]{20,30}$/),
  }),
});
export type StoredPushSubscription = z.infer<typeof pushSubscriptionSchema>;
export function pushPayload(
  lead: NotificationLead,
  siteUrl: string,
  kind: import("./email.ts").NotificationKind = "new_lead",
) {
  return {
    title: `${t(kind === "new_lead" ? "notifications.newLead" : kind === "unanswered_15m" ? "notifications.reminder15" : "notifications.reminder2h")}: ${lead.client_name.slice(0, 120)}`,
    body: [lead.event_type, lead.event_date?.split("-").reverse().join("."), lead.event_city]
      .filter(Boolean)
      .join(" · ")
      .slice(0, 180),
    icon: "/icons/icon-192.png",
    tag: `lead-${lead.id}`,
    url: new URL(leadUrl(siteUrl, lead.id)).pathname,
  };
}
export type PushTransport = (
  subscription: StoredPushSubscription,
  payload: string,
  options: webpush.RequestOptions,
) => Promise<unknown>;
export async function sendPushLead(
  subscription: StoredPushSubscription,
  lead: NotificationLead,
  siteUrl: string,
  vapid: { subject: string; publicKey: string; privateKey: string },
  enabled = false,
  transport: PushTransport = webpush.sendNotification,
  kind: import("./email.ts").NotificationKind = "new_lead",
) {
  if (!enabled) return { status: "disabled" as const };
  pushSubscriptionSchema.parse(subscription);
  try {
    await transport(subscription, JSON.stringify(pushPayload(lead, siteUrl, kind)), {
      TTL: 60,
      vapidDetails: vapid,
      timeout: 5000,
    });
    return { status: "sent" as const };
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "statusCode" in error &&
      [404, 410].includes(Number(error.statusCode))
    )
      return { status: "expired" as const };
    throw error;
  }
}
