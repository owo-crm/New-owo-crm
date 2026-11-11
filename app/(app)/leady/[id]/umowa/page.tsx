import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { PageHeader } from "@/components/app-shell/page";
import { ContractForm } from "@/components/documents/forms";
import { withOrg } from "@/lib/db/user";
import { contractFormDefaults } from "@/lib/documents/service";
import { getLead } from "@/lib/leads/queries";
import { t } from "@/lib/i18n";

export default async function ContractPage({ params }: PageProps<"/leady/[id]/umowa">) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const lead = await getLead(id);
  if (!lead) notFound();
  const values = await withOrg((tx, { organization }) => {
    if (organization.documentEngine !== "barowo" || !organization.modules.includes("documents"))
      redirect(`/leady/${id}`);
    return contractFormDefaults(tx, organization.id, id);
  });
  return (
    <div className="max-w-3xl">
      <PageHeader
        title={t("docs.contractTitle")}
        subtitle={`${lead.client_name} · ${t("docs.contractIntro")}`}
      />
      <ContractForm leadId={id} values={values} />
    </div>
  );
}
