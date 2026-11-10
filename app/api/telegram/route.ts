import { after } from "next/server";
import { getDb } from "@/lib/db";
import { createTelegramBot } from "@/lib/notify/telegram";
import { createTelegramRepository } from "@/lib/notify/telegram-repository";
import { kickNotifications } from "@/lib/notify/kick";
import { appConfig } from "@/lib/config";

// Вебхук Telegram: привязка аккаунта (/start), быстрый лид (/nowylead), кнопка «Skontaktowano».
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (process.env.OUTBOUND_NOTIFICATIONS_ENABLED !== "true")
    return new Response(null, { status: 503 });
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret || req.headers.get("x-telegram-bot-api-secret-token") !== secret)
    return new Response(null, { status: 401 });
  if (Number(req.headers.get("content-length") ?? 0) > 32768)
    return new Response(null, { status: 413 });
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const username = process.env.TELEGRAM_BOT_USERNAME;
  if (!token || !username) return new Response(null, { status: 503 });
  try {
    const bot = createTelegramBot({
      token,
      username,
      repository: createTelegramRepository(getDb(), (id) => after(() => kickNotifications(id))),
      siteUrl: appConfig.siteUrl,
      enabled: true,
    });
    await bot.handleUpdate(await req.json());
    return Response.json({ ok: true });
  } catch (error) {
    console.error("[telegram]", (error as Error).message);
    return new Response(null, { status: 503 });
  }
}
