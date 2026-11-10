import type { DeliveryConfig } from "./delivery-sender.ts";
export function deliveryConfig(get: (key: string) => string | undefined): DeliveryConfig {
  return {
    enabled: get("OUTBOUND_NOTIFICATIONS_ENABLED") === "true",
    siteUrl: get("SITE_URL") ?? "http://localhost:3000",
    telegramToken: get("TELEGRAM_BOT_TOKEN"),
    vapidPublicKey: get("VAPID_PUBLIC_KEY"),
    vapidPrivateKey: get("VAPID_PRIVATE_KEY"),
    vapidSubject: get("VAPID_SUBJECT"),
    resendKey: get("RESEND_API_KEY"),
    emailFrom: get("NOTIFICATION_EMAIL_FROM"),
  };
}
