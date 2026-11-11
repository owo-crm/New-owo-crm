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
  const month =
    typeof params.m === "string" && /^\d{4}-\d{2}$/.test(params.m)
      ? params.m
      : warsawToday().slice(0, 7);
  return (
    <>
      <PageHeader title={t("agency.form.titleNew")} subtitle={t("agency.form.intro")} />
      <OrderForm
        clients={data.clients}
        members={data.members}
        shares={data.shares}
        currentUserId={data.currentUserId}
        initial={{
          clientId: data.clients.some((c) => c.id === preset) ? preset : "",
          title: "",
          kind: "project",
          amountGrosze: 0,
          directCostsGrosze: 0,
          adBudgetGrosze: 0,
          sellers: [{ userId: data.currentUserId, shareBp: 10000 }],
          workBasis: "hours",
          costs: [],
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
