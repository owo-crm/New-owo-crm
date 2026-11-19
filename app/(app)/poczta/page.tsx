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
import { withOrg } from "@/lib/db/user";
import type { PreparedDocument } from "@/components/inbox/composer";

export const metadata: Metadata = { title: t("mailing.title") };

const EMAIL = /^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Poczta: «Wiadomości» — переписка с клиентами (входящие и ответы, решение 051)
 * и «Rozsyłki» — массовые письма (решение 037).
 */
export default async function MailingPage({ searchParams }: PageProps<"/poczta">) {
  const params = await searchParams;
  const uuid = (v: unknown) => (typeof v === "string" && UUID.test(v) ? v : undefined);
  const leadParam = uuid(params.lead);
  const tplParam = uuid(params.tpl);
  const docParam = uuid(params.doc);
  // Рассылка — только явно (?tab=rozsylki) или старая ссылка «?lead=» без чата/шаблона/документа
  // (так раньше открывали рассылку с выбранным получателем). Документы из «Szybkie działania»
  // приходят с ?lead=&tpl= / ?doc= — это всегда «Wiadomości» (решение 053).
  const tab =
    params.tab === "rozsylki" ||
    (leadParam && !params.c && !tplParam && !docParam && params.tab !== "wiadomosci")
      ? "rozsylki"
      : "wiadomosci";
  const preselect = tab === "rozsylki" ? leadParam : undefined;
  let counterpart =
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

  // Переход из карточки лида: адрес берём из лида (под RLS), а не из адресной строки.
  const fromLead = leadParam ? await chatTarget(leadParam, docParam) : null;
  if (fromLead?.email) counterpart = fromLead.email;

  const [threads, templates, thread] = await Promise.all([
    listThreads(),
    listTemplates("all"),
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
            initialTemplateId={
              tplParam && templates.some((x) => x.id === tplParam) ? tplParam : undefined
            }
            preparedDocument={fromLead?.document ?? null}
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

/** Лид для чата и документ, созданный формой: только своей фирмы и этого лида. */
async function chatTarget(leadId: string, documentId?: string) {
  return withOrg(async (tx, { organization }) => {
    const lead = (
      await tx.query<{ email: string | null }>(
        "select email from public.leads where organization_id=$1 and id=$2 and deleted_at is null",
        [organization.id, leadId],
      )
    ).rows[0];
    if (!lead) return null;
    const email =
      lead.email && EMAIL.test(lead.email.trim()) ? lead.email.trim().toLowerCase() : null;
    const document = documentId
      ? ((
          await tx.query<PreparedDocument>(
            `select d.id, d.number, f.id as "fileId", f.filename
               from public.documents d
               join public.document_files f on f.organization_id = d.organization_id
                and f.document_id = d.id and f.format = 'pdf'
              where d.organization_id=$1 and d.id=$2 and d.lead_id=$3 and d.status <> 'cancelled'`,
            [organization.id, documentId, leadId],
          )
        ).rows[0] ?? null)
      : null;
    return { email, document };
  });
}
