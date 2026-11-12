import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Шифрование паролей почты и ключей API (решение 035).
 * AES-256-GCM, ключ — 32 байта в base64 в переменной MAIL_SECRET_KEY.
 * Формат: "v1:<iv>:<tag>:<шифротекст>" (base64url). Без ключа — понятная ошибка, а не открытый текст.
 * Ключ создаётся один раз: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.
 */
export class MailSecretKeyMissing extends Error {
  constructor() {
    super("mail_secret_key_missing");
  }
}

function key(raw = process.env.MAIL_SECRET_KEY): Buffer {
  if (!raw) throw new MailSecretKeyMissing();
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) throw new Error("MAIL_SECRET_KEY: oczekiwano 32 bajtów w base64");
  return buf;
}

export function encryptSecret(plain: string, rawKey?: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(rawKey), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv, tag, data]
    .map((p) => (typeof p === "string" ? p : p.toString("base64url")))
    .join(":");
}

export function decryptSecret(stored: string, rawKey?: string): string {
  const [version, iv, tag, data] = stored.split(":");
  if (version !== "v1" || !iv || !tag || data === undefined)
    throw new Error("mail_secret_bad_format");
  const decipher = createDecipheriv("aes-256-gcm", key(rawKey), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(data, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function isMailSecretKeyConfigured() {
  try {
    key();
    return true;
  } catch {
    return false;
  }
}
