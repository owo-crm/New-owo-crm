import { describe, expect, it } from "vitest";
import {
  encodeForm,
  signWebhookPayload,
  stripeConfig,
  verifyWebhookSignature,
} from "@/lib/billing/stripe";

describe("Stripe: запросы и подпись вебхуков", () => {
  it("вложенные параметры кодируются как ждёт Stripe", () => {
    expect(
      decodeURIComponent(
        encodeForm({
          items: [{ id: "si_1", price_data: { unit_amount: 3900 }, deleted: undefined }],
          proration_behavior: "always_invoice",
        }),
      ),
    ).toBe(
      "items[0][id]=si_1&items[0][price_data][unit_amount]=3900&proration_behavior=always_invoice",
    );
  });

  it("подпись: верная проходит, подделка и старая — нет", () => {
    const body = '{"id":"evt_1"}';
    const now = 1_800_000_000;
    const header = signWebhookPayload(body, "whsec_test", now);
    expect(verifyWebhookSignature(body, header, "whsec_test", now)).toBe(true);
    expect(verifyWebhookSignature(body + " ", header, "whsec_test", now)).toBe(false);
    expect(verifyWebhookSignature(body, header, "whsec_other", now)).toBe(false);
    expect(verifyWebhookSignature(body, header, "whsec_test", now + 3600)).toBe(false);
    expect(verifyWebhookSignature(body, null, "whsec_test", now)).toBe(false);
  });

  it("без ключа Stripe выключен, налог по умолчанию — ставка, не Stripe Tax", () => {
    expect(stripeConfig({})).toBeNull();
    expect(
      stripeConfig({ STRIPE_SECRET_KEY: "sk_test_x", STRIPE_TAX_RATE_ID: "txr_1" }),
    ).toMatchObject({
      taxRateId: "txr_1",
      automaticTax: false,
    });
  });
});
