import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";

/** Пароли: scrypt (встроен в Node, без нативных зависимостей). Формат: scrypt$N$r$p$salt$hash. */
const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 64;

function derive(password: string, salt: Buffer, n = N, r = R, p = P) {
  return new Promise<Buffer>((resolve, reject) =>
    scrypt(
      password.normalize("NFKC"),
      salt,
      KEYLEN,
      { N: n, r, p, maxmem: 64 * 1024 * 1024 },
      (err, key) => (err ? reject(err) : resolve(key)),
    ),
  );
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

export async function verifyPassword(password: string, stored: string) {
  const [scheme, n, r, p, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  const actual = await derive(
    password,
    Buffer.from(salt, "base64url"),
    Number(n),
    Number(r),
    Number(p),
  );
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** Случайный токен для cookie/ссылки (уходит пользователю) и его хэш (хранится в базе). */
export function newToken() {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: sha256(token) };
}

export function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

/** Хэш-заглушка для пользователя, которого нет: время ответа одинаковое, e-mail не угадать. */
export const DUMMY_HASH = "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA$" + "A".repeat(86);
