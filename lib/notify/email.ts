import { z } from "zod";
import { t } from "../i18n.ts";
import { escapeHtml, leadUrl, type NotificationLead } from "./telegram.ts";
export type NotificationKind =
  | "new_lead"
  | "unanswered_15m"
  | "unanswered_2h"
  | "payment_3d"
  | "payment_today"
  | "payment_overdue";

const TITLES: Record<NotificationKind, string> = {
  new_lead: "notifications.emailNew",
  unanswered_15m: "notifications.reminder15",
  unanswered_2h: "notifications.reminder2h",
  payment_3d: "notifications.payment3d",
  payment_today: "notifications.paymentToday",
  payment_overdue: "notifications.paymentOverdue",
};
export function emailContent(
  lead: NotificationLead,
  siteUrl: string,
  kind: NotificationKind = "new_lead",
) {
  const title = t(TITLES[kind] as "notifications.emailNew");
  const name = lead.client_name.replace(/[\r\n]+/g, " ").slice(0, 200);
  const details = [
    lead.event_type,
    lead.event_date?.split("-").reverse().join("."),
    lead.event_city,
  ]
    .filter(Boolean)
    .join(" · ");
  const contact = lead.phone_e164 || lead.email || t("notifications.noContact");
  const url = leadUrl(siteUrl, lead.id);
  const lines = [
    title,
    name,
    details,
    contact,
    t("notifications.source", { source: lead.source_label }),
    url,
  ];
  return {
    subject: `${title}: ${name}`,
    text: lines.filter(Boolean).join("\n"),
    html: `<h1>${escapeHtml(title)}</h1><p><strong>${escapeHtml(name)}</strong></p><p>${escapeHtml(details)}</p><p>${escapeHtml(contact)}</p><p>${escapeHtml(t("notifications.source", { source: lead.source_label }))}</p><p><a href="${escapeHtml(url)}">${escapeHtml(t("notifications.open"))}</a></p>`,
  };
}
/** Intended recipient is the CRM member resolved by the queue, never the lead's email. */
export async function sendEmailLead(options: {
  lead: NotificationLead;
  recipient: string;
  from: string;
  apiKey: string;
  deliveryId: string;
  siteUrl: string;
  kind?: NotificationKind;
  enabled?: boolean;
  fetch?: typeof fetch;
}) {
  if (!options.enabled) return { status: "disabled" as const };
  z.email().parse(options.recipient);
  z.email().parse(options.from);
  z.uuid().parse(options.deliveryId);
  const request = options.fetch ?? globalThis.fetch;
  const response = await request("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `notification/${options.deliveryId}`,
    },
    body: JSON.stringify({
      from: options.from,
      to: [options.recipient],
      ...emailContent(options.lead, options.siteUrl, options.kind),
    }),
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`resend_http_${response.status}`);
  const result = z.object({ id: z.string() }).parse(await response.json());
  return { status: "sent" as const, providerId: result.id };
}
