import Link from "next/link";
import { Card, PageHeader } from "@/components/app-shell/page";
import { NotificationPreferences } from "@/components/notifications/preferences";
import { PushManager } from "@/components/notifications/push-manager";
import { vapidPublicKey } from "@/lib/notify/vapid";
import { withOrg } from "@/lib/db/user";
import { t } from "@/lib/i18n";
export default async function NotificationSettingsPage() {
  // Telegram-бот — только у Barowo и у кабинета OWO Ads; у остальных — push и e-mail.
  const { rows: data, telegramAllowed } = await withOrg(async (tx, { user, organization }) => {
    const telegramAllowed =
      organization.documentEngine === "barowo" || organization.industryPreset === "agency";
    const { rows } = await tx.query<{ channel: "telegram" | "push" | "email"; enabled: boolean }>(
      "select channel,enabled from public.notification_settings where organization_id=$1 and user_id=$2",
      [organization.id, user.id],
    );
    return {
      rows: telegramAllowed ? rows : rows.filter((r) => r.channel !== "telegram"),
      telegramAllowed,
    };
  });
  return (
    <div className="max-w-2xl">
      <PageHeader
        back={{ href: "/ustawienia", label: t("nav.settings") }}
        title={t("settings.notifications")}
      />
      <Card title={t("pwa.pushTitle")} className="mb-5">
        <PushManager
          publicKey={await vapidPublicKey()}
          enabled={process.env.OUTBOUND_NOTIFICATIONS_ENABLED === "true"}
        />
      </Card>
      <Card>
        <NotificationPreferences
          telegramAllowed={telegramAllowed}
          initial={data ?? []}
          telegramReady={
            process.env.OUTBOUND_NOTIFICATIONS_ENABLED === "true" &&
            Boolean(process.env.TELEGRAM_BOT_USERNAME)
          }
        />
        <Link href="/zainstaluj" className="mt-6 inline-flex min-h-11 items-center underline">
          {t("pwa.title")}
        </Link>
      </Card>
    </div>
  );
}
