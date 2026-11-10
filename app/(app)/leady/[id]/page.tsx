import { notFound } from "next/navigation";
import { z } from "zod";
import { LeadEditor } from "@/components/leads/lead-editor";
import { getLead, getLeadHistory, getLeadOptions } from "@/lib/leads/queries";
import { LiveUpdates } from "@/components/leads/live-updates";
export default async function LeadPage({ params }: PageProps<"/leady/[id]">) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const lead = await getLead(id);
  if (!lead) notFound();
  const [options, history] = await Promise.all([getLeadOptions(), getLeadHistory(id)]);
  return (
    <>
      <LeadEditor lead={lead} stages={options.stages} team={options.team} history={history} />
      <div className="mt-5">
        <LiveUpdates organizationId={lead.organization_id} />
      </div>
    </>
  );
}
