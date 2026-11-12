import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Ссылка «Wypisz się» в каждом рекламном письме.
 *
 * Токен — подпись адреса ключом рассылки: хранить ничего не надо, подделать нельзя,
 * а ссылка работает и через год. Ключ тот же, что шифрует пароли почты.
 */
function key() {
  const raw = process.env.MAIL_SECRET_KEY;
  if (!raw) throw new Error("MAIL_SECRET_KEY is not set");
  return Buffer.from(raw, "base64");
}

export function unsubscribeToken(organizationId: string, email: string) {
  return createHmac("sha256", key())
    .update(`${organizationId}:${email.trim().toLowerCase()}`)
    .digest("hex")
    .slice(0, 32);
}

export function checkUnsubscribeToken(organizationId: string, email: string, token: string) {
  const expected = Buffer.from(unsubscribeToken(organizationId, email));
  const given = Buffer.from(String(token ?? ""));
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export function unsubscribeUrl(origin: string, organizationId: string, email: string) {
  const address = email.trim().toLowerCase();
  const params = new URLSearchParams({
    o: organizationId,
    e: address,
    t: unsubscribeToken(organizationId, address),
  });
  return `${origin.replace(/\/$/, "")}/wypisz?${params}`;
}
