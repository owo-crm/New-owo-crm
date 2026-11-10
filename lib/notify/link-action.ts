"use server";
import { withOrg } from "@/lib/db/user";
import { tokenHash } from "./telegram";
export async function createTelegramLink() {
  const username = process.env.TELEGRAM_BOT_USERNAME;
  if (!username || !/^[A-Za-z0-9_]{5,32}$/.test(username))
    return { error: "telegram_not_configured" };
  const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
  try {
    const hash = await tokenHash(token);
    await withOrg((tx, { organization }) =>
      tx.query("select public.create_telegram_link($1,$2)", [organization.id, hash]),
    );
  } catch {
    return { error: "telegram_link_failed" };
  }
  return { url: `https://t.me/${username}?start=${token}` };
}
