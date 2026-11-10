import { Card, PageHeader } from "@/components/app-shell/page";
import { PushManager } from "@/components/notifications/push-manager";
import { requireOrganization } from "@/lib/auth/session";
import { t } from "@/lib/i18n";
export default async function InstallPage() {
  await requireOrganization();
  return (
    <>
      <PageHeader title={t("pwa.title")} subtitle={t("pwa.subtitle")} />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title={t("pwa.iphoneTitle")}>
          <ol className="text-ink-soft list-inside list-decimal space-y-3">
            <li>{t("pwa.iphone1")}</li>
            <li>{t("pwa.iphone2")}</li>
            <li>{t("pwa.iphone3")}</li>
          </ol>
        </Card>
        <Card title={t("pwa.androidTitle")}>
          <p className="text-ink-soft">{t("pwa.androidText")}</p>
        </Card>
        <Card title={t("pwa.pushTitle")} className="lg:col-span-2">
          <PushManager
            publicKey={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ""}
            enabled={process.env.OUTBOUND_NOTIFICATIONS_ENABLED === "true"}
          />
        </Card>
      </div>
    </>
  );
}
