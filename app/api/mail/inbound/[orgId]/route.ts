import { z } from "zod";
import { getDb } from "@/lib/db";
import { receivedEvent, statusEvent, verifyWebhook } from "@/lib/mail/inbound";
import { applyStatus, loadInboundSecret, storeInbound } from "@/lib/mail/inbox";

/**
 * Приём почты фирмы (решение 051). Resend получает письмо на домен фирмы и шлёт сюда
 * событие email.received. Подпись проверяется секретом этой фирмы — без него запрос
 * отклоняется. Ответ 2xx означает «принято»; на ошибку Resend повторит отправку сам.
 */
export const dynamic = "force-dynamic";

const MAX_BODY = 256 * 1024;

export async function POST(
  request: Request,
  { params }: RouteContext<"/api/mail/inbound/[orgId]">,
) {
  const { orgId } = await params;
  if (!z.uuid().safeParse(orgId).success) return new Response(null, { status: 404 });
  const body = await request.text();
  if (body.length > MAX_BODY) return new Response(null, { status: 413 });

  const db = getDb();
  const secret = await loadInboundSecret(db, orgId);
  if (!secret) return Response.json({ error: "not_configured" }, { status: 404 });
  const ok = verifyWebhook(
    secret,
    {
      id: request.headers.get("svix-id") ?? request.headers.get("webhook-id"),
      timestamp: request.headers.get("svix-timestamp") ?? request.headers.get("webhook-timestamp"),
      signature: request.headers.get("svix-signature") ?? request.headers.get("webhook-signature"),
    },
    body,
  );
  if (!ok) return Response.json({ error: "bad_signature" }, { status: 401 });

  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return Response.json({ error: "bad_json" }, { status: 400 });
  }
  // Судьба отправленного письма: доставлено, открыто, отказ (решение 052).
  const status = statusEvent.safeParse(json);
  if (status.success) {
    const result = await applyStatus(db, orgId, status.data);
    return Response.json({ ok: true, ...result });
  }
  // Прочие события подтверждаем, чтобы Resend не повторял их.
  if ((json as { type?: string })?.type !== "email.received") return Response.json({ ok: true });
  const event = receivedEvent.safeParse(json);
  if (!event.success) return Response.json({ error: "bad_event" }, { status: 400 });

  const result = await storeInbound(db, orgId, event.data);
  return Response.json({ ok: true, stored: result.stored });
}
