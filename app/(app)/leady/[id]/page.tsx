import { notFound } from "next/navigation";
import { z } from "zod";
import { LeadEditor } from "@/components/leads/lead-editor";
import { DocumentsCard } from "@/components/documents/documents-card";
import { getLead, getLeadHistory, getLeadOptions } from "@/lib/leads/queries";
import { LiveUpdates } from "@/components/leads/live-updates";
import { withOrg } from "@/lib/db/user";
import { listDocuments } from "@/lib/documents/service";
export default async function LeadPage({ params, searchParams }: PageProps<"/leady/[id]">) {
  const { id } = await params;
  const { dokument } = await searchParams;
  if (!z.uuid().safeParse(id).success) notFound();
  const lead = await getLead(id);
  if (!lead) notFound();
  const [options, history, docs] = await Promise.all([
    getLeadOptions(),
    getLeadHistory(id),
    withOrg(async (tx, { organization }) => ({
      enabled: organization.documentEngine === "barowo",
      list: await listDocuments(tx, organization.id, id),
    })),
  ]);
  return (
    <>
      <LeadEditor
        lead={lead}
        stages={options.stages}
        team={options.team}
        history={history}
        documents={
          <DocumentsCard
            leadId={id}
            enabled={docs.enabled}
            documents={docs.list}
            flash={typeof dokument === "string" ? dokument.slice(0, 60) : undefined}
          />
        }
      />
      <div className="mt-5">
        <LiveUpdates organizationId={lead.organization_id} />
      </div>
    </>
  );
}
