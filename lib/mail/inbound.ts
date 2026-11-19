import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

/**
 * Входящая почта (решение 051) — чистая логика без базы: проверка подписи вебхука Resend,
 * разбор события, превращение HTML в текст и отрезание цитаты, чтобы в чате было видно
 * только новое сообщение клиента.
 */

/**
 * Resend подписывает вебхуки по схеме Svix: HMAC-SHA256 от `${id}.${timestamp}.${body}`
 * ключом из секрета `whsec_<base64>`. Подписей в заголовке может быть несколько (смена ключа).
 * Старше 5 минут — отказ, чтобы перехваченный запрос нельзя было повторить.
 */
export function verifyWebhook(
  secret: string,
  headers: { id: string | null; timestamp: string | null; signature: string | null },
  body: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowSeconds - ts) > 300) return false;
  const key = Buffer.from(secret.trim().replace(/^whsec_/, ""), "base64");
  if (!key.length) return false;
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest();
  return signature.split(" ").some((part) => {
    const [version, value] = part.split(",");
    if (version !== "v1" || !value) return false;
    const given = Buffer.from(value, "base64");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

const address = z.string().max(400);

export const receivedEvent = z.object({
  type: z.string(),
  data: z.object({
    email_id: z.string().min(1).max(200),
    from: address,
    to: z.array(address).default([]),
    subject: z.string().max(2000).nullish(),
    message_id: z.string().max(998).nullish(),
    attachments: z
      .array(
        z.object({
          id: z.string().max(200),
          filename: z.string().max(300).nullish(),
          content_type: z.string().max(200).nullish(),
        }),
      )
      .default([]),
  }),
});
export type ReceivedEvent = z.infer<typeof receivedEvent>;

/** «Anna Nowak <anna@x.pl>» → { email: "anna@x.pl", name: "Anna Nowak" }. */
export function parseAddress(raw: string): { email: string; name: string | null } {
  const match = raw.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  const email = (match ? match[2] : raw).trim().toLowerCase();
  const name = match?.[1]?.trim() || null;
  return { email, name };
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  "#39": "'",
  apos: "'",
  nbsp: " ",
};

/** Грубое, но безопасное превращение HTML письма в текст (для чата показываем только текст). */
export function htmlToText(html: string): string {
  return html
    .replace(/<(style|script|head)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6]|blockquote)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(
      /&(#?\w+);/g,
      (m, e: string) =>
        ENTITIES[e] ?? (e.startsWith("#") ? String.fromCharCode(Number(e.slice(1)) || 32) : m),
    )
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Отрезать цитату предыдущего письма: «W dniu … napisał(a):», «On … wrote:», строки «>»,
 * «-----Original Message-----». Если после отрезания ничего не осталось — вернуть как было.
 */
export function stripQuote(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const markers = [
    /^\s*(W dniu|Dnia)\b.*(napisał|napisała|napisał\(a\))/i,
    /^\s*On\b.*wrote:?\s*$/i,
    /^\s*-{2,}\s*(Original Message|Wiadomość oryginalna|Oryginalna wiadomość)/i,
    /^\s*(Od|From):\s.+/i,
    /^\s*>/,
  ];
  const cut = lines.findIndex((line) => markers.some((m) => m.test(line)));
  const kept = (cut === -1 ? lines : lines.slice(0, cut)).join("\n").trim();
  return kept || text.trim();
}

/** «Re: Re: Oferta» → «Re: Oferta». */
export function replySubject(subject: string) {
  const base = subject.replace(/^\s*((re|odp|aw|fwd?)\s*:\s*)+/i, "").trim();
  return base ? `Re: ${base}` : "Re:";
}
