import "server-only";
import { cache } from "react";
import { getDb } from "@/lib/db";

/**
 * Ключи VAPID: из переменных Railway, а если их нет — созданные приложением при запуске
 * (platform_secrets, решение 043). Тема по умолчанию — адрес агентства.
 */
export async function vapidKeys() {
  const fromEnv = {
    publicKey: process.env.VAPID_PUBLIC_KEY || process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
    privateKey: process.env.VAPID_PRIVATE_KEY,
  };
  const subject = process.env.VAPID_SUBJECT || "mailto:kontakt@owoads.pl";
  if (fromEnv.publicKey && fromEnv.privateKey)
    return { publicKey: fromEnv.publicKey, privateKey: fromEnv.privateKey, subject };
  try {
    const { rows } = await getDb().query<{ key: string; value: string }>(
      "select key, value from public.platform_secrets where key in ('vapid_public_key','vapid_private_key')",
    );
    const get = (k: string) => rows.find((r) => r.key === k)?.value;
    return { publicKey: get("vapid_public_key"), privateKey: get("vapid_private_key"), subject };
  } catch {
    return { publicKey: undefined, privateKey: undefined, subject };
  }
}

/** Публичный ключ для подписки в браузере (страницы «Powiadomienia» и «Zainstaluj»). */
export const vapidPublicKey = cache(async () => (await vapidKeys()).publicKey ?? "");
