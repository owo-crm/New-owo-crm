import type { Metadata } from "next";
import { PageHeader } from "@/components/app-shell/page";
import { ClientForm } from "@/components/agency/client-form";
import { requireAgency } from "@/lib/agency/repository";
import { warsawToday } from "@/lib/format";
import { t } from "@/lib/i18n";

export const metadata: Metadata = { title: t("agency.client.titleNew") };

export default async function NewClientPage() {
  await requireAgency();
  return (
    <>
      <PageHeader
        back={{ href: "/agencja", label: t("nav.agency") }}
        title={t("agency.client.titleNew")}
      />
      <ClientForm
        initial={{
          name: "",
          nip: "",
          contactName: "",
          phone: "",
          email: "",
          city: "",
          status: "active",
          startedAt: warsawToday(),
          note: "",
        }}
      />
    </>
  );
}
