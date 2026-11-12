import type { Metadata } from "next";
import { Card, PageHeader } from "@/components/app-shell/page";
import { MailSettingsForm, type MailSettingsView } from "@/components/settings/mail-form";
import { getDb } from "@/lib/db";
import { withOrg } from "@/lib/db/user";
import { recipientsSentToday } from "@/lib/mail/service";
import { mailKeyStatus } from "@/lib/mail/secret";
import { t } from "@/lib/i18n";

export const metadata: Metadata = { title: t("mail.title") };

export default async function MailSettingsPage() {
  const { view, canEdit, orgId } = await withOrg(async (tx, { organization }) => {
    const row = (
      await tx.query<{
        transport: MailSettingsView["transport"];
        from_name: string | null;
        from_email: string | null;
        reply_to: string | null;
        smtp_host: string | null;
        smtp_port: number | null;
        smtp_user: string | null;
        daily_limit: number;
        last_test_at: string | null;
        last_test_ok: boolean | null;
        last_test_error: string | null;
      }>(
        `select transport, from_name, from_email, reply_to, smtp_host, smtp_port, smtp_user,
                daily_limit, last_test_at, last_test_ok, last_test_error
           from public.organization_mail_settings where organization_id=$1`,
        [organization.id],
      )
    ).rows[0];
    const secretSet = (
      await tx.query<{ set: boolean }>("select public.mail_secret_is_set($1) as set", [
        organization.id,
      ])
    ).rows[0]?.set;
    const view: MailSettingsView = {
      transport: row?.transport ?? "none",
      fromName: row?.from_name ?? organization.name,
      fromEmail: row?.from_email ?? "",
      replyTo: row?.reply_to ?? "",
      smtpHost: row?.smtp_host ?? "smtp.gmail.com",
      smtpPort: row?.smtp_port ?? 587,
      smtpUser: row?.smtp_user ?? "",
      dailyLimit: row?.daily_limit ?? 450,
      secretSet: Boolean(secretSet),
      lastTestAt: row?.last_test_at ?? null,
      lastTestOk: row?.last_test_ok ?? null,
      lastTestError: row?.last_test_error ?? null,
      sentToday: 0,
    };
    return {
      view,
      canEdit: ["owner", "admin"].includes(organization.role),
      orgId: organization.id,
    };
  });
  view.sentToday = await recipientsSentToday(getDb(), orgId);

  return (
    <div className="max-w-2xl">
      <PageHeader
        back={{ href: "/ustawienia", label: t("nav.settings") }}
        title={t("mail.title")}
      />
      <Card>
        <MailSettingsForm initial={view} canEdit={canEdit} keyStatus={mailKeyStatus()} />
      </Card>
    </div>
  );
}
