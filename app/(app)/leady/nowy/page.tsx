import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/app-shell/page";
import { NewLeadForm } from "@/components/leads/new-lead-form";
import { requireOrganization } from "@/lib/auth/session";
import { isAgency } from "@/lib/presets";
import { t } from "@/lib/i18n";
export const metadata: Metadata = { title: t("nav.newLead") };
export default async function NewLeadPage() {
  const { organization } = await requireOrganization();
  // У агентства свой лид: фирма, кто привёл, услуги, рекламный бюджет — пошаговой формой.
  if (isAgency(organization.industryPreset)) redirect("/agencja/leady/nowy");
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        back={{ href: "/leady", label: t("nav.leads") }}
        title={t("nav.newLead")}
        subtitle={t("leads.newSubtitle")}
      />
      <NewLeadForm />
    </div>
  );
}
