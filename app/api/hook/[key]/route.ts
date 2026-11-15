import { webhookHandler } from "@/lib/channels/handlers";

// Универсальный вебхук: POST /api/hook/<public_key канала типа webhook> (решение 044).
export const dynamic = "force-dynamic";

export const POST = (request: Request) => webhookHandler()(request);
export const GET = POST;
