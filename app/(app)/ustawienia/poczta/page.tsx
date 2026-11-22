import type { Metadata } from "next";
import { headers } from "next/headers";
import { requireOrganization } from "@/lib/auth/session";
import { TemplatesSettings } from "@/components/settings/templates-settings";
import { listTemplates } from "@/lib/mailing/repository";
import { LetterLookForm, MailInboundForm } from "@/components/settings/mail-inbound-form";
import { Card, PageHeader } from "@/components/app-shell/page";
import { MailSettingsForm, type MailSettingsView } from "@/components/settings/mail-form";
import { getDb } from "@/lib/db";
import { withOrg } from "@/lib/db/user";
import { recipientsSentToday } from "@/lib/mail/service";
import { mailKeyStatus } from "@/lib/mail/secret";
import { t } from "@/lib/i18n";

export const metadata: Metadata = { title: t("mail.title") };

export default async function MailSettingsPage() {
  const { view, canEdit, orgId, inbound, look } = await withOrg(
    async (tx, { organization, user }) => {
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
          letter_theme: "light" | "dark" | null;
          letter_accent: string | null;
          letter_signature: string | null;
          inbound_last_at: string | null;
        }>(
          `select transport, from_name, from_email, reply_to, smtp_host, smtp_port, smtp_user,
                daily_limit, last_test_at, last_test_ok, last_test_error,
                letter_theme, letter_accent, letter_signature, inbound_last_at
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
        testTo: user.email.includes("@") ? user.email : (row?.from_email ?? row?.smtp_user ?? ""),
      };
      const inboundSet = (
        await tx.query<{ set: boolean }>("select public.mail_inbound_is_set($1) as set", [
          organization.id,
        ])
      ).rows[0]?.set;
      return {
        inbound: { secretSet: Boolean(inboundSet), lastAt: row?.inbound_last_at ?? null },
        look: {
          theme: row?.letter_theme ?? ("light" as const),
          accent: row?.letter_accent ?? "#e8000d",
          signature: row?.letter_signature ?? "",
        },
        view,
        canEdit: ["owner", "admin"].includes(organization.role),
        orgId: organization.id,
      };
    },
  );
  view.sentToday = await recipientsSentToday(getDb(), orgId);
  const [templates, stages] = await Promise.all([
    listTemplates("all"),
    withOrg(
      async (tx, { organization }) =>
        (
          await tx.query<{ key: string; label: string }>(
            "select key, label_pl as label from public.pipeline_stages where organization_id=$1 and kind <> 'lost' order by position",
            [organization.id],
          )
        ).rows,
    ),
  ]);
  const { organization: current } = await requireOrganization();
  const canInstallStarter =
    canEdit &&
    current.documentEngine === "barowo" &&
    !templates.some((x) => x.purpose === "document");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const site = `${h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https")}://${host}`;

  return (
    <div className="max-w-2xl">
      <PageHeader
        back={{ href: "/ustawienia", label: t("nav.settings") }}
        title={t("mail.title")}
      />
      <Card>
        <MailSettingsForm initial={view} canEdit={canEdit} keyStatus={mailKeyStatus()} />
      </Card>
      <Card className="mt-5">
        <MailInboundForm
          webhookUrl={`${site}/api/mail/inbound/${orgId}`}
          secretSet={inbound.secretSet}
          lastAt={inbound.lastAt}
          canEdit={canEdit}
        />
      </Card>
      <Card className="mt-5">
        <LetterLookForm initial={look} canEdit={canEdit} />
      </Card>
      {templates.length || canInstallStarter ? (
        <Card className="mt-5">
          <TemplatesSettings
            templates={templates}
            stages={stages}
            canEditDocuments={canEdit}
            canInstallStarter={canInstallStarter}
          />
        </Card>
      ) : null}
    </div>
  );
}
