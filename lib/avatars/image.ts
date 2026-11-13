/**
 * Проверка загруженной аватарки (решение 039). Без базы и Next.js — тестируется отдельно.
 * Тип определяем по первым байтам файла, а не по тому, что прислал браузер.
 */
export const MAX_AVATAR_BYTES = 256 * 1024;

export type AvatarType = "image/png" | "image/jpeg" | "image/webp";

export function sniffAvatarType(bytes: Uint8Array): AvatarType | null {
  const b = bytes;
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47)
    return "image/png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (
    b.length >= 12 &&
    String.fromCharCode(b[0], b[1], b[2], b[3]) === "RIFF" &&
    String.fromCharCode(b[8], b[9], b[10], b[11]) === "WEBP"
  )
    return "image/webp";
  return null;
}

export type AvatarCheck = { ok: true; type: AvatarType } | { ok: false; error: "type" | "size" };

export function checkAvatar(bytes: Uint8Array): AvatarCheck {
  if (!bytes.length || bytes.length > MAX_AVATAR_BYTES) return { ok: false, error: "size" };
  const type = sniffAvatarType(bytes);
  return type ? { ok: true, type } : { ok: false, error: "type" };
}

/** Адрес картинки с версией: после замены браузер не покажет старую из кэша. */
export function avatarUrl(kind: "o" | "u", id: string, version: number | null | undefined) {
  return version ? `/api/awatar/${kind}/${id}?v=${version}` : null;
}
