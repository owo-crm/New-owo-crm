import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
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
  const query = await searchParams;
  const pkg = z.enum(PACKAGE_KEYS).catch("standard").parse(query.pakiet);
  // «Oferta personalna» (решение 053): выбор пакета прямо здесь; после «Generuj» — в чат.
  const personal = query.personal === "1";
  const tpl = z.uuid().safeParse(query.tpl);
  const keep = `${personal ? "&personal=1" : ""}${tpl.success ? `&tpl=${tpl.data}` : ""}`;
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
        back={{ href: `/leady/${id}`, label: lead.client_name }}
        title={t("docs.offerTitle", { pkg: name })}
        subtitle={`${lead.client_name} · ${t("docs.offerIntro")}`}
      />
      <nav aria-label={t("leads.fields.package_name")} className="mb-5 flex flex-wrap gap-2">
        {PACKAGE_KEYS.map((key) => (
          <Link
            key={key}
            href={`/leady/${id}/oferta?pakiet=${key}${keep}`}
            aria-current={key === pkg ? "page" : undefined}
            className={cn(
              buttonVariants({ variant: key === pkg ? "dark" : "secondary", size: "sm" }),
              "min-w-24",
            )}
          >
            {key[0].toUpperCase() + key.slice(1)}
          </Link>
        ))}
      </nav>
      <OfferForm
        key={pkg}
        leadId={id}
        pkg={pkg}
        values={values}
        templateId={tpl.success ? tpl.data : undefined}
      />
    </div>
  );
}
