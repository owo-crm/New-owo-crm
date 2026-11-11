import type { Metadata } from "next";
import { PageHeader } from "@/components/app-shell/page";
import { NewLeadForm } from "@/components/leads/new-lead-form";
import { requireOrganization } from "@/lib/auth/session";
import { t } from "@/lib/i18n";
export const metadata: Metadata = { title: t("nav.newLead") };
export default async function NewLeadPage() {
  await requireOrganization();
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
