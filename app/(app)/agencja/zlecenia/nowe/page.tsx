import type { Metadata } from "next";
import { PageHeader } from "@/components/app-shell/page";
import { OrderForm } from "@/components/agency/order-form";
import { getOrderFormData } from "@/lib/agency/repository";
import { warsawToday } from "@/lib/format";
import { t } from "@/lib/i18n";

export const metadata: Metadata = { title: t("agency.form.titleNew") };

/** Новый заказ. ?klient=<id> — клиент выбран заранее (кнопка из карточки клиента). */
export default async function NewOrderPage({ searchParams }: PageProps<"/agencja/zlecenia/nowe">) {
  const params = await searchParams;
  const data = await getOrderFormData();
  const preset = typeof params.klient === "string" ? params.klient : "";
  // ?usluga=<id> из карточки клиента: услуга, её цена у клиента, название и тип.
  const preService = data.services.find((x) => x.id === params.usluga)?.id ?? null;
  const svc = data.services.find((x) => x.id === preService);
  const svcPrice = data.clientServices.find(
    (c) => c.client_id === preset && c.service_id === preService,
  )?.price_grosze;
  const month =
    typeof params.m === "string" && /^\d{4}-\d{2}$/.test(params.m)
      ? params.m
      : warsawToday().slice(0, 7);
  return (
    <>
      <PageHeader
        back={{ href: "/agencja", label: t("nav.agency") }}
        title={t("agency.form.titleNew")}
        subtitle={t("agency.form.intro")}
      />
      <OrderForm
        clients={data.clients}
        members={data.members}
        shares={data.shares}
        currentUserId={data.currentUserId}
        services={data.services}
        clientServices={data.clientServices}
        initial={{
          clientId: data.clients.some((c) => c.id === preset) ? preset : "",
          title: svc ? svc.name : "",
          kind: svc?.kind ?? "project",
          amountGrosze: svcPrice ?? 0,
          directCostsGrosze: 0,
          adBudgetGrosze: 0,
          sellers: [{ userId: data.currentUserId, shareBp: 10000 }],
          workBasis: "hours",
          costs: [],
          serviceId: preService,
          periodMonth: month,
          status: "draft",
          dueDate: null,
          note: "",
          work: [],
        }}
      />
    </>
  );
}
