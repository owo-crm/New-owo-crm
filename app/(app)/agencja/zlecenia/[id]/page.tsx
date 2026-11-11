import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/app-shell/page";
import { OrderForm } from "@/components/agency/order-form";
import { getOrder, getOrderFormData } from "@/lib/agency/repository";
import { t } from "@/lib/i18n";

export const metadata: Metadata = { title: t("agency.form.titleEdit") };

export default async function EditOrderPage({ params }: PageProps<"/agencja/zlecenia/[id]">) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [order, data] = await Promise.all([getOrder(id), getOrderFormData()]);
  if (!order) notFound();
  return (
    <>
      <PageHeader title={order.title} subtitle={t("agency.form.intro")} />
      <OrderForm
        clients={data.clients}
        members={data.members}
        shares={data.shares}
        currentUserId={data.currentUserId}
        services={data.services}
        clientServices={data.clientServices}
        initial={{
          id: order.id,
          clientId: order.client_id,
          title: order.title,
          kind: order.kind,
          amountGrosze: order.amount_grosze,
          directCostsGrosze: order.direct_costs_grosze,
          adBudgetGrosze: order.ad_budget_grosze,
          sellers: order.sellers,
          workBasis: order.workBasis,
          costs: order.costs,
          serviceId: order.serviceId,
          periodMonth: order.period_month.slice(0, 7),
          status: order.status,
          dueDate: order.due_date,
          note: order.note ?? "",
          work: order.work,
        }}
      />
    </>
  );
}
