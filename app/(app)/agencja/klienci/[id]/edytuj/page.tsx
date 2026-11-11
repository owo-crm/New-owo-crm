import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/app-shell/page";
import { ClientForm } from "@/components/agency/client-form";
import { getClientCard } from "@/lib/agency/repository";
import { t } from "@/lib/i18n";

export const metadata: Metadata = { title: t("agency.client.edit") };

export default async function EditClientPage({
  params,
}: PageProps<"/agencja/klienci/[id]/edytuj">) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const card = await getClientCard(id);
  if (!card) notFound();
  const c = card.client;
  return (
    <>
      <PageHeader title={c.name} subtitle={t("agency.client.edit")} />
      <ClientForm
        initial={{
          id: c.id,
          name: c.name,
          nip: c.nip ?? "",
          contactName: c.contact_name ?? "",
          phone: c.phone ?? "",
          email: c.email ?? "",
          city: c.city ?? "",
          status: c.status,
          startedAt: c.started_at ?? "",
          note: c.note ?? "",
        }}
      />
    </>
  );
}
