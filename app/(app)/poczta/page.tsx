import type { Metadata } from "next";
import Link from "next/link";
import { Inbox, Mail } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/app-shell/page";
import { ModuleLocked } from "@/components/billing/module-locked";
import { MailingPanel } from "@/components/mailing/panel";
import { ThreadList } from "@/components/inbox/thread-list";
import { ThreadView } from "@/components/inbox/thread-view";
import { AutoRefresh } from "@/components/inbox/auto-refresh";
import { buttonVariants } from "@/components/ui/button";
import { moduleAccess } from "@/lib/billing/gate";
import { requireOrganization } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { loadMailSettings } from "@/lib/mail/service";
import { getThread, listThreads } from "@/lib/mail/inbox-read";
import { listCampaigns, listContacts, listTemplates } from "@/lib/mailing/repository";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: t("mailing.title") };

const EMAIL = /^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]+$/;

/**
 * Poczta: «Wiadomości» — переписка с клиентами (входящие и ответы, решение 051)
 * и «Rozsyłki» — массовые письма (решение 037).
 */
export default async function MailingPage({ searchParams }: PageProps<"/poczta">) {
  const params = await searchParams;
  // Из карточки лида раньше вели в рассылку с выбранным получателем — оставляем.
  const preselect =
    typeof params.lead === "string" && /^[0-9a-f-]{36}$/.test(params.lead)
      ? params.lead
      : undefined;
  const tab = params.tab === "rozsylki" || preselect ? "rozsylki" : "wiadomosci";
  const counterpart =
    typeof params.c === "string" && EMAIL.test(params.c.trim())
      ? params.c.trim().toLowerCase()
      : undefined;

  const access = await moduleAccess("documents");
  if (!access.enabled)
    return (
      <>
        <PageHeader title={t("mailing.title")} />
        <ModuleLocked module="documents" requested={access.requested} />
      </>
    );

  const { organization } = await requireOrganization();
  const mail = await loadMailSettings(getDb(), organization.id).catch(() => null);

  const tabs = (
    <nav className="border-line mb-4 flex gap-1 border-b" aria-label={t("mailing.title")}>
      {(
        [
          ["wiadomosci", t("inbox.tab"), "/poczta"],
          ["rozsylki", t("inbox.tabMailing"), "/poczta?tab=rozsylki"],
        ] as const
      ).map(([key, label, href]) => (
        <Link
          key={key}
          href={href}
          aria-current={tab === key ? "page" : undefined}
          className={cn(
            "-mb-px border-b-2 px-3 py-2 text-[14px] font-semibold transition-colors",
            tab === key
              ? "border-accent text-ink"
              : "text-ink-soft hover:text-ink border-transparent",
          )}
        >
          {label}
        </Link>
      ))}
    </nav>
  );

  const header = (
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
  );

  if (tab === "rozsylki") {
    const [contacts, templates, campaigns] = await Promise.all([
      listContacts(),
      listTemplates(),
      listCampaigns(),
    ]);
    return (
      <>
        {header}
        {tabs}
        {contacts.length === 0 ? (
          <EmptyState icon={Mail} title={t("mailing.emptyTitle")} text={t("mailing.emptyText")} />
        ) : (
          <MailingPanel
            contacts={contacts}
            templates={templates}
            campaigns={campaigns}
            dailyLimit={mail?.dailyLimit ?? 450}
            mailReady={Boolean(mail)}
            preselect={preselect}
          />
        )}
      </>
    );
  }

  const [threads, templates, thread] = await Promise.all([
    listThreads(),
    listTemplates(),
    counterpart ? getThread(counterpart) : Promise.resolve(null),
  ]);

  return (
    <>
      {header}
      {tabs}
      <div className="border-line bg-surface grid h-[calc(100dvh-19rem)] min-h-[24rem] overflow-hidden rounded-2xl border md:h-[calc(100dvh-13rem)] md:min-h-[28rem] md:grid-cols-[20rem_1fr]">
        <aside
          className={cn(
            "border-line min-h-0 overflow-y-auto md:border-r",
            counterpart ? "hidden md:block" : "block",
          )}
        >
          <ThreadList threads={threads} active={counterpart} />
          {counterpart ? null : <AutoRefresh />}
        </aside>
        {counterpart && thread ? (
          <ThreadView
            counterpart={counterpart}
            messages={thread.messages}
            lead={thread.lead}
            name={thread.name}
            brand={organization.name}
            templates={templates}
            mailReady={Boolean(mail)}
          />
        ) : (
          <div className="hidden md:flex md:items-center md:justify-center">
            <EmptyState icon={Inbox} title={t("inbox.pickTitle")} text={t("inbox.pickText")} />
          </div>
        )}
      </div>
    </>
  );
}
