import { Bot, InlineKeyboard } from "grammy";
import { z } from "zod";
import { normalizeLead, type NormalizedLead } from "../leads/ingest.ts";
import { t } from "../i18n.ts";
export type NotificationLead = {
  id: string;
  client_name: string;
  phone_e164: string | null;
  email: string | null;
  event_type: string | null;
  event_date: string | null;
  event_city: string | null;
  guests: number | null;
  message: string;
  source_label: string;
};
export function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!,
  );
}
export function leadUrl(siteUrl: string, id: string) {
  z.uuid().parse(id);
  const url = new URL(siteUrl);
  if (!["https:", "http:"].includes(url.protocol)) throw new Error("invalid_site_url");
  return new URL(`/leady/${id}`, url).href;
}
export function telegramMessage(
  lead: NotificationLead,
  kind: import("./email.ts").NotificationKind = "new_lead",
) {
  const date = lead.event_date?.split("-").reverse().join(".") ?? t("notifications.noDate");
  return [
    `${t(kind === "new_lead" ? "notifications.newLead" : kind === "unanswered_15m" ? "notifications.reminder15" : "notifications.reminder2h")} · ${escapeHtml(lead.event_type ?? "")} · ${date}`,
    `<b>${escapeHtml(lead.client_name.slice(0, 200))}</b> · ${escapeHtml(lead.phone_e164 || lead.email || t("notifications.noContact"))}`,
    [
      lead.event_city,
      lead.guests === null ? null : t("notifications.guests", { count: lead.guests }),
    ]
      .filter(Boolean)
      .map((value) => escapeHtml(value!))
      .join(" · "),
    escapeHtml(t("notifications.source", { source: lead.source_label.slice(0, 120) })),
    escapeHtml(lead.message.slice(0, 500)),
  ]
    .filter(Boolean)
    .join("\n");
}
export async function sendTelegramLead(
  bot: Bot,
  lead: NotificationLead,
  chatId: string,
  siteUrl: string,
  enabled = false,
  kind: import("./email.ts").NotificationKind = "new_lead",
) {
  if (!enabled) return { status: "disabled" as const };
  const keyboard = new InlineKeyboard()
    .text(t("notifications.contacted"), `contact:${lead.id}`)
    .row()
    .url(t("notifications.offer"), leadUrl(siteUrl, lead.id))
    .url(t("notifications.open"), leadUrl(siteUrl, lead.id));
  await bot.api.sendMessage(chatId, telegramMessage(lead, kind), {
    parse_mode: "HTML",
    reply_markup: keyboard,
  });
  return { status: "sent" as const };
}
export async function tokenHash(token: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}
export function telegramManualInput(text: string) {
  const [name, contact = "", date = "", city = "", event_type = ""] = text
    .split("|")
    .map((value) => value.trim());
  const event_date = /^\d{2}\.\d{2}\.\d{4}$/.test(date)
    ? date.split(".").reverse().join("-")
    : date;
  return normalizeLead({
    name,
    phone: contact.includes("@") ? "" : contact,
    email: contact.includes("@") ? contact : "",
    event_date,
    city,
    event_type,
  });
}
export type TelegramRepository = {
  redeem(hash: string, chat: string, user: string): Promise<boolean>;
  isLinked(chat: string, user: string): Promise<boolean>;
  ingest(
    chat: string,
    user: string,
    lead: NormalizedLead,
    updateId: number,
  ): Promise<{ id: string }>;
  contact(chat: string, user: string, leadId: string): Promise<boolean>;
};
export function createTelegramBot(options: {
  token: string;
  username: string;
  repository: TelegramRepository;
  siteUrl: string;
  enabled?: boolean;
  fetch?: typeof fetch;
}) {
  const bot = new Bot(options.token, {
    botInfo: {
      id: Number(options.token.split(":")[0]),
      is_bot: true,
      first_name: "Barowo CRM",
      username: options.username,
      can_join_groups: false,
      can_read_all_group_messages: false,
      supports_inline_queries: false,
      can_connect_to_business: false,
      has_main_web_app: false,
      has_topics_enabled: false,
      allows_users_to_create_topics: false,
      can_manage_bots: false,
      supports_join_request_queries: false,
      supports_guest_queries: false,
    },
    client: { fetch: options.fetch ?? globalThis.fetch },
  });
  // Disabled by default, including replies/getMe: importing or calling the bot cannot send accidentally.
  bot.api.config.use(async (previous, method, payload, signal) => {
    if (!options.enabled) throw new Error("outbound_disabled");
    return previous(method, payload, signal);
  });
  bot.use(async (ctx, next) => {
    if (ctx.chat?.type === "private" && ctx.from) await next();
  });
  bot.command("start", async (ctx) => {
    const token = ctx.match;
    if (!/^[a-f0-9]{64}$/.test(token)) {
      await ctx.reply(t("notifications.invalidLink"));
      return;
    }
    const ok = await options.repository.redeem(
      await tokenHash(token),
      String(ctx.chat.id),
      String(ctx.from!.id),
    );
    await ctx.reply(t(ok ? "notifications.linked" : "notifications.invalidLink"));
  });
  bot.command("nowylead", async (ctx) => {
    const chat = String(ctx.chat.id);
    const user = String(ctx.from!.id);
    if (!(await options.repository.isLinked(chat, user))) {
      await ctx.reply(t("notifications.notLinked"));
      return;
    }
    if (!ctx.match) {
      await ctx.reply(t("notifications.manualHelp"));
      return;
    }
    let input: NormalizedLead;
    try {
      input = telegramManualInput(ctx.match);
    } catch {
      await ctx.reply(t("notifications.invalidLead"));
      return;
    }
    const lead = await options.repository.ingest(chat, user, input, ctx.update.update_id);
    await ctx.reply(t("notifications.manualAdded"), {
      reply_markup: new InlineKeyboard().url(
        t("notifications.open"),
        leadUrl(options.siteUrl, lead.id),
      ),
    });
  });
  bot.callbackQuery(/^contact:([0-9a-f-]{36})$/, async (ctx) => {
    const id = ctx.match[1];
    const ok =
      z.uuid().safeParse(id).success &&
      (await options.repository.contact(String(ctx.chat!.id), String(ctx.from.id), id));
    await ctx.answerCallbackQuery({
      text: t(ok ? "notifications.contactSaved" : "notifications.noAccess"),
    });
  });
  return bot;
}
