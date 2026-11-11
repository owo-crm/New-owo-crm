import { getDb } from "@/lib/db";
import { stripeConfig, verifyWebhookSignature } from "@/lib/billing/stripe";
import { handleStripeEvent, type StripeEvent } from "@/lib/billing/sync";

/**
 * Вебхук Stripe: оплаты абонементов, смена статуса подписки.
 * Dashboard → Developers → Webhooks → https://<домен>/api/stripe/webhook, события:
 * checkout.session.completed, customer.subscription.created/updated/deleted,
 * invoice.paid, invoice.payment_failed. Секрет whsec_… → STRIPE_WEBHOOK_SECRET.
 */
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const config = stripeConfig();
  if (!config?.webhookSecret) return new Response(null, { status: 503 });
  if (Number(req.headers.get("content-length") ?? 0) > 512 * 1024)
    return new Response(null, { status: 413 });
  // Подпись считается по «сырому» телу — читаем текст, а не JSON.
  const payload = await req.text();
  if (!verifyWebhookSignature(payload, req.headers.get("stripe-signature"), config.webhookSecret))
    return new Response(null, { status: 400 });
  try {
    const event = JSON.parse(payload) as StripeEvent;
    await handleStripeEvent(getDb(), config, event);
    return Response.json({ received: true });
  } catch (error) {
    // 500 → Stripe повторит событие позже (журнал billing_events не даст обработать дважды).
    console.error("[stripe] webhook", (error as Error).message);
    return new Response(null, { status: 500 });
  }
}
