import { notFound } from "next/navigation";
import { z } from "zod";
import { LeadEditor } from "@/components/leads/lead-editor";
import { DocsPaymentsBlock } from "@/components/documents/docs-payments-block";
import { getLead, getLeadHistory, getLeadOptions, getLeads } from "@/lib/leads/queries";
import { parseLeadFilters } from "@/lib/leads/filters";
import { LeadRail } from "@/components/leads/lead-rail";
import { CompactNav } from "@/components/leads/compact-nav";
import { LiveUpdates } from "@/components/leads/live-updates";
import { withOrg } from "@/lib/db/user";
import { leadPayments, listDocuments } from "@/lib/documents/service";
import { loadPaymentPlan } from "@/lib/finance/payments";
import { LeadClientCard } from "@/components/agency/lead-client-card";
import { clientIdForLead } from "@/lib/agency/repository";
import { listAttachments } from "@/lib/documents/attachments";
export default async function LeadPage({ params, searchParams }: PageProps<"/leady/[id]">) {
  const { id } = await params;
  const { dokument } = await searchParams;
  if (!z.uuid().safeParse(id).success) notFound();
  const lead = await getLead(id);
  if (!lead) notFound();
  const [options, history, docs, agencyClient, files, rail] = await Promise.all([
    getLeadOptions(),
    getLeadHistory(id),
    withOrg(async (tx, { organization }) => ({
      enabled: organization.documentEngine === "barowo",
      list: await listDocuments(tx, organization.id, id),
      payments: await leadPayments(tx, organization.id, id),
      plan: await loadPaymentPlan(tx, organization.id),
      agency: organization.industryPreset === "agency",
      // Карточки модулей показываем, только если модуль включён в абонементе.
      paymentsModule: organization.modules.includes("payments"),
      documentsModule: organization.modules.includes("documents"),
    })),
    clientIdForLead(id),
    listAttachments(id),
    getLeads(parseLeadFilters({})),
  ]);
  // Агентство: на этапе «Klient» (или если клиент уже заведён) — кнопка клиента агентства.
  const showAgency = docs.agency && (lead.stage_key === "client" || agencyClient !== null);
  return (
    <div className="grid items-start gap-4 lg:grid-cols-[17rem_minmax(0,1fr)]" data-lead-split>
      <CompactNav />
      <LeadRail
        leads={rail.leads}
        stages={options.stages}
        currentId={id}
        now={new Date().toISOString()}
      />
      <div className="min-w-0">
        <LeadEditor
          lead={lead}
          serverNow={new Date().toISOString()}
          stages={options.stages}
          team={options.team}
          history={history}
          agencyCard={showAgency ? <LeadClientCard leadId={id} clientId={agencyClient} /> : null}
          // Генерация оферты, договора и меню — кнопками в «Szybkie działania».
          docActions={docs.documentsModule && docs.enabled}
          docsBlock={
            <DocsPaymentsBlock
              leadId={id}
              files={files}
              documents={docs.list}
              payments={docs.payments}
              plan={docs.plan}
              totalGrosze={lead.budget_grosze}
              showDocs={docs.documentsModule}
              showPayments={docs.paymentsModule}
              flash={typeof dokument === "string" ? dokument.slice(0, 60) : undefined}
            />
          }
        />
        <div className="mt-5">
          <LiveUpdates organizationId={lead.organization_id} />
        </div>
      </div>
    </div>
  );
}
