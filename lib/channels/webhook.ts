import { z } from "zod";
import { ingestLead, type IngestRepository, type IngestResult } from "../leads/ingest.ts";

/**
 * Универсальный вебхук (решение 044): POST /api/hook/<ключ канала> из Zapier, Make, Google Ads
 * (формы лидов), Tally, Typeform, конструкторов сайтов. Сервер-сервер: без CORS и без согласия
 * в теле (его собирает форма-источник). Секрет — сам ключ в адресе (UUID, не публикуется на сайтах).
 *
 * Поля распознаются по распространённым названиям (PL/EN, формат Google Ads), свои названия —
 * через config.fieldMap. Всё нераспознанное сохраняется в custom_fields, ничего не теряется.
 */
export type WebhookChannel = {
  id: string;
  organization_id: string;
  name: string;
  config: { fieldMap?: Record<string, string>; lastKeys?: string[] };
};

export const CRM_FIELDS = [
  "name",
  "phone",
  "email",
  "message",
  "event_date",
  "city",
  "event_type",
  "guests",
] as const;
export type CrmField = (typeof CRM_FIELDS)[number];

/** Синонимы: ключ сравнивается без регистра, пробелов, дефисов и подчёркиваний. */
const ALIASES: Record<CrmField, string[]> = {
  name: [
    "name",
    "fullname",
    "imie",
    "imię",
    "imieinazwisko",
    "imięinazwisko",
    "nazwisko",
    "contactname",
    "klient",
    "client",
    "customer",
    "customername",
    "yourname",
  ],
  phone: [
    "phone",
    "phonenumber",
    "tel",
    "telephone",
    "telefon",
    "nrtelefonu",
    "numertelefonu",
    "mobile",
    "mobilephone",
    "komorka",
    "komórka",
    "whatsapp",
  ],
  email: ["email", "mail", "emailaddress", "adresemail", "youremail"],
  message: [
    "message",
    "comment",
    "comments",
    "wiadomosc",
    "wiadomość",
    "notes",
    "note",
    "description",
    "opis",
    "question",
    "pytanie",
    "uwagi",
    "tresc",
    "treść",
  ],
  event_date: ["date", "eventdate", "data", "datawydarzenia", "termin", "datawesela"],
  city: ["city", "miasto", "miejscowosc", "miejscowość", "location", "lokalizacja"],
  event_type: [
    "eventtype",
    "rodzajwydarzenia",
    "typwydarzenia",
    "service",
    "usluga",
    "usługa",
    "rodzaj",
  ],
  guests: ["guests", "goscie", "goście", "liczbagosci", "liczbagości", "people", "osoby"],
};
const FIRST = ["firstname", "imie", "imię", "givenname"];
const LAST = ["lastname", "surname", "nazwisko", "familyname"];

const norm = (key: string) => key.toLowerCase().replace(/[\s_\-.]/g, "");

/** Плоский словарь: вложенные объекты → «a.b», формат Google Ads user_column_data → column_id. */
export function flattenPayload(body: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  const put = (key: string, value: unknown) => {
    if (value === null || value === undefined) return;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      const v = String(value).trim();
      if (v && !(key in out)) out[key] = v.slice(0, 2000);
    }
  };
  const walk = (prefix: string, value: unknown, depth: number) => {
    if (depth > 3) return;
    if (Array.isArray(value)) {
      // Google Ads: [{ column_id: "FULL_NAME", string_value: "…" }]; Typeform/Tally: [{ label|key, value }]
      for (const item of value) {
        if (item && typeof item === "object") {
          const o = item as Record<string, unknown>;
          const k = o.column_id ?? o.column_name ?? o.key ?? o.label ?? o.name ?? o.field;
          const v = o.string_value ?? o.value ?? o.answer ?? o.text;
          if (typeof k === "string" && v !== undefined && (typeof v !== "object" || v === null))
            put(k, v);
          else walk(prefix, o, depth + 1);
        }
      }
      return;
    }
    if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value as Record<string, unknown>))
        walk(prefix ? `${prefix}.${k}` : k, v, depth + 1);
      return;
    }
    put(prefix, value);
  };
  walk("", body, 0);
  return out;
}

/**
 * Сопоставить плоские поля с полями CRM. Сначала fieldMap канала, потом синонимы,
 * затем «imię» + «nazwisko» → имя. Остальное — в custom_fields.
 */
export function mapWebhookPayload(
  body: Record<string, unknown>,
  fieldMap: Record<string, string> = {},
) {
  const flat = flattenPayload(body);
  const lead: Partial<Record<CrmField, string>> = {};
  const used = new Set<string>();
  const byNorm = new Map(Object.keys(flat).map((k) => [norm(k.split(".").at(-1)!), k] as const));
  const fullByNorm = new Map(Object.keys(flat).map((k) => [norm(k), k] as const));

  for (const [source, target] of Object.entries(fieldMap)) {
    const key = fullByNorm.get(norm(source)) ?? byNorm.get(norm(source));
    if (key && (CRM_FIELDS as readonly string[]).includes(target) && !lead[target as CrmField]) {
      lead[target as CrmField] = flat[key];
      used.add(key);
    }
  }
  for (const field of CRM_FIELDS) {
    if (lead[field]) continue;
    for (const alias of ALIASES[field]) {
      const key = byNorm.get(norm(alias));
      if (key && !used.has(key) && !(field === "name" && FIRST.includes(norm(alias)))) {
        lead[field] = flat[key];
        used.add(key);
        break;
      }
    }
  }
  if (!lead.name) {
    const first = FIRST.map((a) => byNorm.get(a)).find((k) => k && !used.has(k));
    const last = LAST.map((a) => byNorm.get(a)).find((k) => k && !used.has(k));
    const full = [first && flat[first], last && flat[last]].filter(Boolean).join(" ");
    if (full) {
      lead.name = full;
      if (first) used.add(first);
      if (last) used.add(last);
    }
  }
  const custom = Object.fromEntries(Object.entries(flat).filter(([k]) => !used.has(k)));
  return { lead, custom, keys: Object.keys(flat).slice(0, 60) };
}

export type WebhookDependencies = {
  findChannel(key: string): Promise<WebhookChannel | null>;
  /** Журнал: только код результата и названия полей (без персональных данных). */
  log(channel: WebhookChannel, ok: boolean, error: string | null, keys: string[]): Promise<void>;
  /** Сколько попыток было за последний час (защита от зацикленного сценария Zapier). */
  recentAttempts(channel: WebhookChannel): Promise<number>;
  repository: IngestRepository | ((submissionId: string | null) => IngestRepository);
  afterIngest?: (result: IngestResult, channel: WebhookChannel) => Promise<void>;
  waitUntil?: (promise: Promise<unknown>) => void;
  now?: () => Date;
};

const HOURLY_LIMIT = 300;

async function readJsonOrForm(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (text.length > 65536) throw new Error("body_too_large");
  const type = request.headers.get("content-type") ?? "";
  if (type.includes("application/x-www-form-urlencoded"))
    return Object.fromEntries(new URLSearchParams(text));
  if (type.includes("multipart/form-data")) {
    const form = await new Response(text, { headers: { "content-type": type } }).formData();
    const out: Record<string, unknown> = {};
    for (const [k, v] of form) if (typeof v === "string") out[k] = v;
    return out;
  }
  // JSON по умолчанию — многие сервисы шлют его без заголовка.
  return z.record(z.string(), z.unknown()).parse(JSON.parse(text || "{}"));
}

export function createWebhookHandler(deps: WebhookDependencies) {
  return async (request: Request): Promise<Response> => {
    const headers = { "Cache-Control": "no-store" };
    const reply = (status: number, body: Record<string, unknown>) =>
      Response.json(body, { status, headers });
    const key = new URL(request.url).pathname.split("/").filter(Boolean).at(-1);
    if (!key || !z.uuid().safeParse(key).success) return reply(404, { error: "channel_not_found" });
    const channel = await deps.findChannel(key);
    if (!channel) return reply(404, { error: "channel_not_found" });
    if (request.method !== "POST") return reply(405, { error: "method_not_allowed" });
    if ((await deps.recentAttempts(channel)) >= HOURLY_LIMIT) {
      await deps.log(channel, false, "rate_limited", []);
      return reply(429, { error: "rate_limited" });
    }
    let body: Record<string, unknown>;
    try {
      body = await readJsonOrForm(request);
    } catch {
      await deps.log(channel, false, "invalid_body", []);
      return reply(400, { error: "invalid_body" });
    }
    const { lead, custom: allCustom, keys } = mapWebhookPayload(body, channel.config.fieldMap);
    // utm_* — метки рекламы: в отдельное поле utm, по нему вкладка «Reklama» связывает заявку с кампанией.
    const utm: Record<string, string> = {};
    const custom: Record<string, string> = {};
    for (const [k, v] of Object.entries(allCustom)) {
      const m = k.toLowerCase().match(/(?:^|\.)utm_([a-z]+)$/);
      if (m) utm[m[1]] = v.slice(0, 500);
      else custom[k] = v;
    }
    const rawSubmission =
      request.headers.get("idempotency-key") ??
      (typeof body.submission_id === "string" ? body.submission_id : null) ??
      (typeof body.lead_id === "string" ? body.lead_id : null);
    const submissionId =
      rawSubmission && /^[A-Za-z0-9_.:-]{6,100}$/.test(rawSubmission)
        ? `hook:${rawSubmission}`
        : null;
    const repository =
      typeof deps.repository === "function" ? deps.repository(submissionId) : deps.repository;
    let result: IngestResult;
    try {
      result = await ingestLead(
        { ...lead, custom_fields: custom, utm },
        {
          organizationId: channel.organization_id,
          channelId: channel.id,
          sourceLabel: channel.name,
          consentAt: (deps.now?.() ?? new Date()).toISOString(),
        },
        repository,
      );
    } catch (error) {
      // Нет ни телефона, ни e-mail — CRM не может создать лид: говорим, какие поля пришли.
      await deps.log(
        channel,
        false,
        error instanceof z.ZodError ? "no_contact" : "internal_error",
        keys,
      );
      return reply(error instanceof z.ZodError ? 422 : 503, {
        error: error instanceof z.ZodError ? "no_contact" : "temporarily_unavailable",
        received_fields: keys,
      });
    }
    await deps.log(channel, true, null, keys);
    if (deps.afterIngest) {
      const task = deps.afterIngest(result, channel).catch(() => {});
      if (deps.waitUntil) deps.waitUntil(task);
      else await task;
    }
    return reply(200, { ok: true, lead_id: result.id });
  };
}
