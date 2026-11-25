import "server-only";
import { linkLeadToPropertySlug } from "@/lib/realestate/properties";
import { after } from "next/server";
import { createHmac } from "node:crypto";
import { createIntakeHandler, type WebsiteChannel } from "@/lib/channels/website";
import { createWebhookHandler, type WebhookChannel } from "@/lib/channels/webhook";
import { createIngestRepository } from "@/lib/leads/repository";
import { getDb, one } from "@/lib/db";
import { kickNotifications } from "@/lib/notify/kick";

/**
 * Сборка обработчиков приёма заявок: их используют маршруты /api/intake и /api/hook,
 * и кнопка «Wyślij test» в «Źródła leadów» — тестовая заявка идёт тем же путём, что настоящая.
 */
/**
 * Переходный период: копия заявки уходит и в старую систему (бот Barowo), чтобы обе работали
 * параллельно. Включается полем forwardUrl в настройках канала, выключается удалением.
 */
async function forwardToLegacy(url: string | undefined, raw: Record<string, unknown>) {
  if (!url || !/^https:\/\//.test(url)) return;
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(raw)) if (typeof v === "string") body.append(k, v);
  try {
    const res = await fetch(url + (url.includes("?") ? "&" : "?") + "format=json", {
      method: "POST",
      headers: { Accept: "application/json" },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) console.error("[intake] forward", res.status);
  } catch (error) {
    console.error("[intake] forward", (error as Error).message);
  }
}

export function websiteHandler() {
  const db = getDb();
  const salt = process.env.INTAKE_IP_SALT;
  if (!salt) throw new Error("Brak INTAKE_IP_SALT");
  return createIntakeHandler({
    repository: (submissionId) => createIngestRepository(db, submissionId),
    // Railway проставляет реальный IP клиента в X-Real-IP; другой прокси — TRUSTED_IP_HEADER.
    clientIp: (req) => req.headers.get(process.env.TRUSTED_IP_HEADER || "x-real-ip"),
    async findChannel(key) {
      return one<WebsiteChannel>(
        db,
        "select id, organization_id, name, config from public.channels where public_key=$1 and type='website' and status='active'",
        [key],
      );
    },
    async hashIp(ip) {
      return createHmac("sha256", salt).update(ip).digest("hex");
    },
    async reserveAttempt(channel, ipHash) {
      const row = await one<{ r: { id: string; allowed: boolean } }>(
        db,
        "select public.reserve_intake($1,$2,$3) as r",
        [channel.organization_id, channel.id, ipHash],
      );
      return row!.r;
    },
    async finishAttempt(id, ok, error) {
      await db.query("update public.intake_log set ok=$1, error=$2 where id=$3", [ok, error, id]);
    },
    async afterIngest(result, channel, raw) {
      await Promise.allSettled([
        kickNotifications(result.id),
        forwardToLegacy(channel.config.forwardUrl, raw),
        // Formularz ze strony konkretnej nieruchomości: typowana relacja lead ↔ obiekt.
        typeof raw.property_slug === "string"
          ? linkLeadToPropertySlug(db, channel.organization_id, result.id, raw.property_slug).then(
              (ok) => ok || console.warn(`[intake] property_slug not linked for lead ${result.id}`),
            )
          : null,
      ]);
    },
    waitUntil: (promise) => after(() => promise),
  });
}

export function webhookHandler() {
  const db = getDb();
  return createWebhookHandler({
    repository: (submissionId) => createIngestRepository(db, submissionId),
    findChannel: (key) =>
      one<WebhookChannel>(
        db,
        "select id, organization_id, name, config from public.channels where public_key=$1 and type='webhook' and status='active'",
        [key],
      ),
    async recentAttempts(channel) {
      const row = await one<{ n: number }>(
        db,
        "select count(*)::int as n from public.intake_log where channel_id=$1 and received_at > now() - interval '1 hour'",
        [channel.id],
      );
      return row?.n ?? 0;
    },
    async log(channel, ok, error, keys) {
      await db.query(
        "insert into public.intake_log (organization_id, channel_id, ok, error, payload) values ($1,$2,$3,$4,$5)",
        [channel.organization_id, channel.id, ok, error, { keys }],
      );
    },
    afterIngest: async (result) => {
      await kickNotifications(result.id);
    },
    waitUntil: (promise) => after(() => promise),
  });
}
