import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { PageHeader } from "@/components/app-shell/page";
import { OfferForm } from "@/components/documents/forms";
import { withOrg } from "@/lib/db/user";
import { offerFormDefaults } from "@/lib/documents/service";
import { PACKAGE_KEYS } from "@/lib/documents/barowo/engine";
import { getLead } from "@/lib/leads/queries";
import { t } from "@/lib/i18n";

export default async function OfferPage({ params, searchParams }: PageProps<"/leady/[id]/oferta">) {
  const { id } = await params;
  const pkg = z
    .enum(PACKAGE_KEYS)
    .catch("standard")
    .parse((await searchParams).pakiet);
  if (!z.uuid().safeParse(id).success) notFound();
  const lead = await getLead(id);
  if (!lead) notFound();
  const values = await withOrg((tx, { organization }) => {
    if (organization.documentEngine !== "barowo" || !organization.modules.includes("documents"))
      redirect(`/leady/${id}`);
    return offerFormDefaults(tx, organization.id, id, pkg);
  });
  const name = pkg[0].toUpperCase() + pkg.slice(1);
  return (
    <div className="max-w-3xl">
      <PageHeader
        title={t("docs.offerTitle", { pkg: name })}
        subtitle={`${lead.client_name} · ${t("docs.offerIntro")}`}
      />
      <OfferForm leadId={id} pkg={pkg} values={values} />
    </div>
  );
}
