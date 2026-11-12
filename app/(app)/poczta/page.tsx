import type { Metadata } from "next";
import Link from "next/link";
import { Mail } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/app-shell/page";
import { ModuleLocked } from "@/components/billing/module-locked";
import { MailingPanel } from "@/components/mailing/panel";
import { buttonVariants } from "@/components/ui/button";
import { moduleAccess } from "@/lib/billing/gate";
import { requireOrganization } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { loadMailSettings } from "@/lib/mail/service";
import { listCampaigns, listContacts, listTemplates } from "@/lib/mailing/repository";
import { t } from "@/lib/i18n";

export const metadata: Metadata = { title: t("mailing.title") };

/** Панель рассылок: кому → что → как выглядит → отправить (решение 037). */
export default async function MailingPage() {
  const access = await moduleAccess("documents");
  if (!access.enabled)
    return (
      <>
        <PageHeader title={t("mailing.title")} />
        <ModuleLocked module="documents" requested={access.requested} />
      </>
    );

  const { organization } = await requireOrganization();
  const [contacts, templates, campaigns, mail] = await Promise.all([
    listContacts(),
    listTemplates(),
    listCampaigns(),
    loadMailSettings(getDb(), organization.id),
  ]);

  return (
    <>
      <PageHeader
        title={t("mailing.title")}
        aside={
          <Link
            href="/ustawienia/poczta"
            className={buttonVariants({ variant: "secondary", size: "sm" })}
          >
            {t("mailing.settings")}
          </Link>
        }
      />
      {contacts.length === 0 ? (
        <EmptyState icon={Mail} title={t("mailing.emptyTitle")} text={t("mailing.emptyText")} />
      ) : (
        <MailingPanel
          contacts={contacts}
          templates={templates}
          campaigns={campaigns}
          dailyLimit={mail?.dailyLimit ?? 450}
          mailReady={Boolean(mail)}
        />
      )}
    </>
  );
}
