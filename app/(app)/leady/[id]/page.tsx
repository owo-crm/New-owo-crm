import { notFound } from "next/navigation";
import { z } from "zod";
import { LeadEditor } from "@/components/leads/lead-editor";
import { DocumentsCard } from "@/components/documents/documents-card";
import { getLead, getLeadHistory, getLeadOptions } from "@/lib/leads/queries";
import { LiveUpdates } from "@/components/leads/live-updates";
import { withOrg } from "@/lib/db/user";
import { leadPayments, listDocuments } from "@/lib/documents/service";
import { PaymentsCard } from "@/components/finance/payments-card";
import { LeadClientCard } from "@/components/agency/lead-client-card";
import { clientIdForLead } from "@/lib/agency/repository";
export default async function LeadPage({ params, searchParams }: PageProps<"/leady/[id]">) {
  const { id } = await params;
  const { dokument } = await searchParams;
  if (!z.uuid().safeParse(id).success) notFound();
  const lead = await getLead(id);
  if (!lead) notFound();
  const [options, history, docs, agencyClient] = await Promise.all([
    getLeadOptions(),
    getLeadHistory(id),
    withOrg(async (tx, { organization }) => ({
      enabled: organization.documentEngine === "barowo",
      list: await listDocuments(tx, organization.id, id),
      payments: await leadPayments(tx, organization.id, id),
      agency: organization.industryPreset === "agency",
      // Карточки модулей показываем, только если модуль включён в абонементе.
      paymentsModule: organization.modules.includes("payments"),
      documentsModule: organization.modules.includes("documents"),
    })),
    clientIdForLead(id),
  ]);
  // Агентство: на этапе «Klient» (или если клиент уже заведён) — кнопка клиента агентства.
  const showAgency = docs.agency && (lead.stage_key === "client" || agencyClient !== null);
  return (
    <>
      <LeadEditor
        lead={lead}
        stages={options.stages}
        team={options.team}
        history={history}
        // Пришли с готовым документом — сразу открываем вкладку документов.
        initialTab={typeof dokument === "string" ? "docs" : undefined}
        documentsCount={docs.list.length}
        agencyCard={showAgency ? <LeadClientCard leadId={id} clientId={agencyClient} /> : null}
        paymentsCard={docs.paymentsModule ? <PaymentsCard payments={docs.payments} /> : null}
        documentsCard={
          docs.documentsModule ? (
            <DocumentsCard
              leadId={id}
              enabled={docs.enabled}
              documents={docs.list}
              flash={typeof dokument === "string" ? dokument.slice(0, 60) : undefined}
            />
          ) : null
        }
      />
      <div className="mt-5">
        <LiveUpdates organizationId={lead.organization_id} />
      </div>
    </>
  );
}
