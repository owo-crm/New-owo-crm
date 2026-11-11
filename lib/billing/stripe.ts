import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Минимальный клиент Stripe REST API без SDK: несколько вызовов, которые нам нужны,
 * легко подменяются в тестах (fetchImpl). Ключи — только в переменных окружения Railway.
 *
 * STRIPE_SECRET_KEY        — sk_live_… / sk_test_…
 * STRIPE_WEBHOOK_SECRET    — whsec_… (Dashboard → Developers → Webhooks)
 * STRIPE_TAX_RATE_ID       — txr_… ставка VAT 23 % «exclusive» (бесплатно, для фирм из Польши)
 * STRIPE_AUTOMATIC_TAX     — true: Stripe Tax считает налог сам (+0,5 % от оборота; нужен
 *                            только при продажах за границу). По умолчанию выключен.
 */
export type StripeConfig = {
  secretKey: string;
  webhookSecret?: string;
  taxRateId?: string;
  automaticTax: boolean;
  fetchImpl?: typeof fetch;
};

export function stripeConfig(
  env: Record<string, string | undefined> = process.env,
): StripeConfig | null {
  const secretKey = env.STRIPE_SECRET_KEY?.trim();
  if (!secretKey) return null;
  return {
    secretKey,
    webhookSecret: env.STRIPE_WEBHOOK_SECRET?.trim() || undefined,
    taxRateId: env.STRIPE_TAX_RATE_ID?.trim() || undefined,
    automaticTax: env.STRIPE_AUTOMATIC_TAX === "true",
  };
}

export class StripeError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

type Param = string | number | boolean | null | undefined | Param[] | { [key: string]: Param };

/** Stripe принимает application/x-www-form-urlencoded с вложенностью a[b][0][c]=… */
export function encodeForm(params: Record<string, Param>): string {
  const out: string[] = [];
  const walk = (prefix: string, value: Param) => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) value.forEach((v, i) => walk(`${prefix}[${i}]`, v));
    else if (typeof value === "object")
      for (const [k, v] of Object.entries(value)) walk(prefix ? `${prefix}[${k}]` : k, v);
    else out.push(`${encodeURIComponent(prefix)}=${encodeURIComponent(String(value))}`);
  };
  walk("", params);
  return out.join("&");
}

export async function stripeRequest<T>(
  config: StripeConfig,
  method: "GET" | "POST" | "DELETE",
  path: string,
  params: Record<string, Param> = {},
  idempotencyKey?: string,
): Promise<T> {
  const body = encodeForm(params);
  const url = `https://api.stripe.com${path}${method === "GET" && body ? `?${body}` : ""}`;
  const res = await (config.fetchImpl ?? fetch)(url, {
    method,
    headers: {
      authorization: `Bearer ${config.secretKey}`,
      "content-type": "application/x-www-form-urlencoded",
      ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
    },
    body: method === "GET" ? undefined : body,
  });
  const json = (await res.json().catch(() => ({}))) as {
    error?: { message?: string; code?: string };
  };
  if (!res.ok)
    throw new StripeError(
      json.error?.message ?? `Stripe ${res.status}`,
      res.status,
      json.error?.code,
    );
  return json as T;
}

/**
 * Проверка подписи вебхука (заголовок Stripe-Signature: t=…,v1=…).
 * HMAC-SHA256 от «t.тело» секретом whsec_…; старше tolerance секунд — отказ (повтор атаки).
 */
export function verifyWebhookSignature(
  payload: string,
  header: string | null,
  secret: string,
  now = Math.floor(Date.now() / 1000),
  toleranceSeconds = 300,
) {
  if (!header) return false;
  const parts = header.split(",").map((p) => p.trim().split("="));
  const t = Number(parts.find(([k]) => k === "t")?.[1]);
  const signatures = parts.filter(([k]) => k === "v1").map(([, v]) => v ?? "");
  if (!Number.isFinite(t) || signatures.length === 0) return false;
  if (Math.abs(now - t) > toleranceSeconds) return false;
  const expected = Buffer.from(
    createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex"),
  );
  return signatures.some((s) => {
    const got = Buffer.from(s);
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
}

/** Для тестов: подпись в формате Stripe. */
export function signWebhookPayload(
  payload: string,
  secret: string,
  t = Math.floor(Date.now() / 1000),
) {
  const v1 = createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex");
  return `t=${t},v1=${v1}`;
}
