import { one, type Queryable } from "../db/core.ts";
import { decryptSecret } from "./secret.ts";
import { loadMailSettings } from "./service.ts";
import { htmlToText, parseAddress, type ReceivedEvent } from "./inbound.ts";

/**
 * Переписка с клиентами (решение 051): запись входящих от Resend, догрузка тела письма,
 * запись исходящих. Функции с `db` вызываются соединением владельца базы (приём вебхука,
 * фоновая очередь); чтение для экранов — через RLS в lib/mail/inbox-read.ts.
 */

const MAX_HTML = 500_000;
const MAX_TEXT = 200_000;

/** Секрет подписи вебхука фирмы (расшифрованный) или null, если приём не настроен. */
export async function loadInboundSecret(db: Queryable, organizationId: string) {
  const row = await one<{ inbound_secret_ciphertext: string | null }>(
    db,
    "select inbound_secret_ciphertext from public.organization_mail_settings where organization_id = $1",
    [organizationId],
  );
  if (!row?.inbound_secret_ciphertext) return null;
  try {
    return decryptSecret(row.inbound_secret_ciphertext);
  } catch {
    return null;
  }
}

/** Лид с этим e-mail — самый свежий (клиент мог писать несколько раз). */
export async function findLeadByEmail(db: Queryable, organizationId: string, email: string) {
  const row = await one<{ id: string }>(
    db,
    `select id from public.leads
      where organization_id = $1 and lower(email) = $2 and deleted_at is null
      order by created_at desc limit 1`,
    [organizationId, email],
  );
  return row?.id ?? null;
}

type FetchDeps = { fetch?: typeof fetch };

/** Тело письма из API Resend. Ключ с правом «Sending access» сюда не пускают — нужен «Full access». */
export async function fetchReceivedBody(
  apiKey: string,
  emailId: string,
  deps: FetchDeps = {},
): Promise<{ text: string; html: string | null; fromHeader: string | null } | null> {
  const request = deps.fetch ?? globalThis.fetch;
  const response = await request(
    `https://api.resend.com/emails/receiving/${encodeURIComponent(emailId)}`,
    { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(15_000) },
  ).catch(() => null);
  if (!response?.ok) return null;
  const data = (await response.json().catch(() => null)) as {
    text?: string | null;
    html?: string | null;
    headers?: Record<string, string> | null;
  } | null;
  if (!data) return null;
  const html = data.html ? data.html.slice(0, MAX_HTML) : null;
  const text = (data.text?.trim() || (html ? htmlToText(html) : "")).slice(0, MAX_TEXT);
  return { text, html, fromHeader: data.headers?.from ?? null };
}

/**
 * Сохранить входящее письмо. Повтор того же вебхука ничего не дублирует (provider_id уникален).
 * Тело забирается сразу; не вышло (ключ без доступа, Resend недоступен) — body_pending,
 * повтор в фоновой очереди.
 */
export async function storeInbound(
  db: Queryable,
  organizationId: string,
  event: ReceivedEvent,
  deps: FetchDeps = {},
) {
  const from = parseAddress(event.data.from);
  if (!from.email.includes("@")) return { stored: false as const, reason: "bad_from" };
  const settings = await loadMailSettings(db, organizationId).catch(() => null);
  // Письмо от самих себя (копия, автоответ по кругу) в переписку не кладём.
  if (settings?.settings.fromEmail?.toLowerCase() === from.email)
    return { stored: false as const, reason: "own_address" };

  const leadId = await findLeadByEmail(db, organizationId, from.email);
  const inserted = await one<{ id: string }>(
    db,
    `insert into public.mail_messages
       (organization_id, lead_id, direction, counterpart, counterpart_name, subject,
        body_pending, provider_id, message_id, attachments)
     values ($1, $2, 'in', $3, $4, $5, true, $6, $7, $8)
     on conflict (organization_id, provider_id) where provider_id is not null do nothing
     returning id`,
    [
      organizationId,
      leadId,
      from.email,
      from.name?.slice(0, 200) ?? null,
      (event.data.subject ?? "").slice(0, 500),
      event.data.email_id,
      event.data.message_id ?? null,
      JSON.stringify(
        event.data.attachments.map((a) => ({
          id: a.id,
          filename: a.filename ?? "plik",
          contentType: a.content_type ?? null,
        })),
      ),
    ],
  );
  await db.query(
    "update public.organization_mail_settings set inbound_last_at = now() where organization_id = $1",
    [organizationId],
  );
  if (!inserted) return { stored: false as const, reason: "duplicate" };
  await loadBody(db, organizationId, inserted.id, event.data.email_id, deps);
  return { stored: true as const, id: inserted.id, leadId };
}

async function loadBody(
  db: Queryable,
  organizationId: string,
  messageId: string,
  providerId: string,
  deps: FetchDeps,
) {
  const settings = await loadMailSettings(db, organizationId).catch(() => null);
  if (settings?.settings.transport !== "resend" || !settings.settings.secret) return false;
  const body = await fetchReceivedBody(settings.settings.secret, providerId, deps);
  if (!body) return false;
  const name = body.fromHeader ? parseAddress(body.fromHeader).name : null;
  await db.query(
    `update public.mail_messages
        set body_text = $3, body_html = $4, body_pending = false,
            counterpart_name = coalesce(counterpart_name, $5)
      where organization_id = $1 and id = $2`,
    [organizationId, messageId, body.text, body.html, name?.slice(0, 200) ?? null],
  );
  return true;
}

/** Фоновая очередь: догрузить тела писем, которые не удалось забрать сразу (до 3 суток). */
export async function retryPendingBodies(db: Queryable, deps: FetchDeps = {}) {
  const { rows } = await db.query<{ id: string; organization_id: string; provider_id: string }>(
    `select id, organization_id, provider_id from public.mail_messages
      where body_pending and provider_id is not null and created_at > now() - interval '3 days'
      order by created_at limit 20`,
  );
  let loaded = 0;
  for (const row of rows)
    if (await loadBody(db, row.organization_id, row.id, row.provider_id, deps)) loaded += 1;
  return loaded;
}

/** Исходящее письмо из переписки — в ту же ленту. */
export async function recordOutgoing(
  db: Queryable,
  input: {
    organizationId: string;
    leadId: string | null;
    to: string;
    subject: string;
    text: string;
    html: string | null;
    inReplyTo: string | null;
    sentBy: string;
  },
) {
  await db.query(
    `insert into public.mail_messages
       (organization_id, lead_id, direction, counterpart, subject, body_text, body_html,
        in_reply_to, read_at, sent_by)
     values ($1, $2, 'out', $3, $4, $5, $6, $7, now(), $8)`,
    [
      input.organizationId,
      input.leadId,
      input.to,
      input.subject.slice(0, 500),
      input.text.slice(0, MAX_TEXT),
      input.html?.slice(0, MAX_HTML) ?? null,
      input.inReplyTo,
      input.sentBy,
    ],
  );
}
