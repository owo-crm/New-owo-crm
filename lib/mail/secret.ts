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

/** Убирает то, что часто прилипает при копировании: пробелы, переносы строк, кавычки. */
function clean(raw: string) {
  return raw
    .trim()
    .replace(/^["']|["']$/g, "")
    .trim();
}

/** Ключ: 32 байта в base64 (openssl rand -base64 32) или 64 символа hex (openssl rand -hex 32). */
export function parseMailKey(raw: string): Buffer | null {
  const value = clean(raw);
  if (/^[0-9a-fA-F]{64}$/.test(value)) return Buffer.from(value, "hex");
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(value)) return null;
  const buf = Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  return buf.length === 32 ? buf : null;
}

function key(raw = process.env.MAIL_SECRET_KEY): Buffer {
  if (!raw || !clean(raw)) throw new MailSecretKeyMissing();
  const buf = parseMailKey(raw);
  if (!buf) throw new Error("mail_secret_key_invalid");
  return buf;
}

/** Состояние ключа для экрана настроек — без раскрытия самого ключа. */
export function mailKeyStatus(raw = process.env.MAIL_SECRET_KEY): "ok" | "missing" | "invalid" {
  if (!raw || !clean(raw)) return "missing";
  return parseMailKey(raw) ? "ok" : "invalid";
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
  return mailKeyStatus() === "ok";
}
