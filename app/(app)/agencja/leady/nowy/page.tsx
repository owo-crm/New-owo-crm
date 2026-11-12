import type { Metadata } from "next";
import { PageHeader } from "@/components/app-shell/page";
import { LeadWizard } from "@/components/agency/lead-wizard";
import { getOrderFormData } from "@/lib/agency/repository";
import { listServices } from "@/lib/agency/services";
import { t } from "@/lib/i18n";

export const metadata: Metadata = { title: t("agency.lead.title") };

/** Новый лид агентства: пошагово — контакт, кто привёл, услуги, бюджет. */
export default async function NewAgencyLeadPage() {
  const [data, services] = await Promise.all([getOrderFormData(), listServices()]);
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        back={{ href: "/leady", label: t("nav.leads") }}
        title={t("agency.lead.title")}
        subtitle={t("agency.lead.intro")}
      />
      <LeadWizard
        members={data.members}
        services={services
          .filter((s) => s.active)
          .map((s) => ({ id: s.id, name: s.name, system_key: s.system_key }))}
      />
    </div>
  );
}
