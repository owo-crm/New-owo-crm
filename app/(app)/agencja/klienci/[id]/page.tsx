import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil, Plus } from "lucide-react";
import { Card, PageHeader } from "@/components/app-shell/page";
import { buttonVariants } from "@/components/ui/button";
import {
  ClientCrmControls,
  OrderStatusButtons,
  SetupChecklist,
} from "@/components/agency/client-actions";
import { ClientStatusBadge, OrderStatusBadge, monthLabel } from "@/components/agency/labels";
import { getClientCard } from "@/lib/agency/repository";
import { listAdAccounts } from "@/lib/agency/ads";
import { listClientServices, listServices } from "@/lib/agency/services";
import { AdBudgetCard } from "@/components/agency/ad-budget";
import { ClientServicesPanel } from "@/components/agency/services-ui";
import { CreateCrmWizard, SubscriptionPanel } from "@/components/billing/subscription-panel";
import { getBillingView } from "@/lib/billing/repository";
import { isAddonKey } from "@/lib/billing/modules";
import { totalsBySplit } from "@/lib/agency/split";
import { getCurrentUser, getOrganizations } from "@/lib/auth/session";
import { formatMoney } from "@/lib/finance/money";
import { plDate, plDateTime } from "@/lib/format";
import { t, type MessageKey } from "@/lib/i18n";
import { isAgency } from "@/lib/presets";

export const metadata: Metadata = { title: t("agency.clients.title") };

/** Карточка клиента агентства: реквизиты, чек-лист настройки CRM, заказы с разделом, история. */
export default async function ClientPage({ params }: PageProps<"/agencja/klienci/[id]">) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const card = await getClientCard(id);
  if (!card) notFound();
  const { client, steps, orders, members } = card;
  // Клиент принадлежит этому агентству (getClientCard проверил) — абонемент его CRM можно читать.
  const [user, orgs, billing, services, clientServices, adAccounts] = await Promise.all([
    getCurrentUser(),
    getOrganizations(),
    client.client_org_id ? getBillingView(client.client_org_id) : null,
    listServices(),
    listClientServices(client.id),
    listAdAccounts(client.id),
  ]);
  const nameOf = (uid: string | null) =>
    uid ? (members.find((m) => m.userId === uid)?.name ?? "—") : t("agency.split.unassigned");
  const done = steps.filter((s) => s.doneAt).length;

  // История собирается из того, что уже есть в базе: заказы, оплаты, шаги настройки.
  const history = [
    {
      at: client.created_at,
      text: client.lead_id ? t("agency.client.fromLead") : t("agency.client.created"),
    },
    ...orders.map((o) => ({
      at: o.created_at,
      text: t("agency.client.orderCreated", { title: o.title }),
    })),
    ...orders
      .filter((o) => o.paid_at)
      .map((o) => ({ at: o.paid_at!, text: t("agency.client.orderPaid", { title: o.title }) })),
    ...steps
      .filter((s) => s.doneAt)
      .map((s) => ({
        at: s.doneAt!,
        text: t("agency.client.stepDone", { step: t(`agency.steps.${s.key}` as MessageKey) }),
      })),
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 30);

  const details: [MessageKey, string | null][] = [
    ["agency.client.contactName", client.contact_name],
    ["agency.client.phone", client.phone],
    ["agency.client.email", client.email],
    ["agency.client.city", client.city],
    ["agency.client.nip", client.nip],
    ["agency.client.startedAt", client.started_at ? plDate(client.started_at) : null],
  ];

  return (
    <>
      <PageHeader
        back={{ href: "/agencja", label: t("nav.agency") }}
        title={client.name}
        subtitle={undefined}
        aside={
          <div className="flex flex-wrap gap-2">
            <Link
              href={`/agencja/klienci/${client.id}/edytuj`}
              className={buttonVariants({ variant: "secondary" })}
            >
              <Pencil />
              {t("agency.client.edit")}
            </Link>
            <Link
              href={`/agencja/zlecenia/nowe?klient=${client.id}`}
              className={buttonVariants({ variant: "primary" })}
            >
              <Plus />
              {t("agency.newOrder")}
            </Link>
          </div>
        }
      />
      <p className="-mt-3 mb-5">
        <ClientStatusBadge status={client.status} />
      </p>

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="grid min-w-0 grid-cols-1 gap-5">
          <Card title={t("agency.services.client")}>
            <ClientServicesPanel
              clientId={client.id}
              items={clientServices}
              services={services}
              members={members}
            />
          </Card>

          <Card title={t("agency.ads.title")}>
            <AdBudgetCard
              clientId={client.id}
              budgetGrosze={
                clientServices.find((c) => c.system_key === "ads")?.monthly_budget_grosze ?? null
              }
              accounts={adAccounts}
            />
          </Card>

          <Card title={t("agency.client.orders")}>
            {orders.length === 0 ? (
              <p className="text-ink-soft text-sm">{t("agency.client.ordersEmpty")}</p>
            ) : (
              <ul className="divide-line divide-y" data-testid="client-orders">
                {orders.map((o) => {
                  const split = totalsBySplit(o.split);
                  return (
                    <li key={o.id} className="grid gap-2 py-3 first:pt-0 last:pb-0">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                        <Link
                          href={`/agencja/zlecenia/${o.id}`}
                          className="min-w-0 font-semibold hover:underline"
                        >
                          {o.title}
                        </Link>
                        <span className="font-semibold tabular-nums">
                          {formatMoney(o.amount_grosze)}
                        </span>
                      </div>
                      <div className="text-ink-soft flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
                        <OrderStatusBadge status={o.status} />
                        <span>{t(`agency.kind.${o.kind}` as MessageKey)}</span>
                        <span>{monthLabel(o.period_month)}</span>
                        {o.due_date ? (
                          <span>{t("finance.due", { date: plDate(o.due_date) })}</span>
                        ) : null}
                        {o.ad_budget_grosze > 0 ? (
                          <span>
                            {t("agency.form.adBudget")}: {formatMoney(o.ad_budget_grosze)}
                          </span>
                        ) : null}
                      </div>
                      <details className="text-[13px]">
                        <summary className="text-ink-soft cursor-pointer font-semibold">
                          {t("agency.client.splitOf")}
                        </summary>
                        <ul className="mt-1.5 grid gap-1 tabular-nums">
                          {split.people.map((p) => (
                            <li key={p.userId} className="flex justify-between gap-3">
                              <span>{nameOf(p.userId)}</span>
                              <span>{formatMoney(p.totalGrosze)}</span>
                            </li>
                          ))}
                          {split.unassignedGrosze > 0 ? (
                            <li className="text-hold flex justify-between gap-3 font-semibold">
                              <span>{t("agency.split.unassigned")}</span>
                              <span>{formatMoney(split.unassignedGrosze)}</span>
                            </li>
                          ) : null}
                          <li className="text-ink-soft flex justify-between gap-3">
                            <span>{t("agency.split.company")}</span>
                            <span>{formatMoney(split.companyGrosze)}</span>
                          </li>
                          {o.direct_costs_grosze > 0 ? (
                            <li className="text-ink-soft flex justify-between gap-3">
                              <span>{t("agency.split.costs")}</span>
                              <span>{formatMoney(o.direct_costs_grosze)}</span>
                            </li>
                          ) : null}
                        </ul>
                      </details>
                      <OrderStatusButtons id={o.id} status={o.status} />
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card title={t("agency.client.history")}>
            {history.length === 0 ? (
              <p className="text-ink-soft text-sm">{t("agency.client.historyEmpty")}</p>
            ) : (
              <ul className="grid gap-1.5 text-sm">
                {history.map((h, i) => (
                  <li key={i} className="flex gap-3">
                    <span className="text-ink-faint w-[8.5rem] shrink-0 tabular-nums">
                      {plDateTime(h.at)}
                    </span>
                    <span className="min-w-0">{h.text}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="grid gap-5">
          <Card title={t("agency.client.setupTitle")}>
            <p className="text-ink-soft -mt-1 mb-3 text-[13px]">
              {client.client_org_name
                ? t("agency.client.crm", { name: client.client_org_name })
                : t("agency.client.noCrm")}{" "}
              · {t("agency.clients.setup", { done, total: steps.length })}
            </p>
            <div className="mb-4">
              <ClientCrmControls
                clientId={client.id}
                clientOrgId={client.client_org_id}
                canOpen={orgs.some((o) => o.id === client.client_org_id)}
                linkable={orgs
                  .filter((o) => !isAgency(o.industryPreset))
                  .map((o) => ({ id: o.id, name: o.name }))}
              />
            </div>
            <p className="text-ink-faint mb-2 text-[12px]">{t("agency.client.setupIntro")}</p>
            <SetupChecklist
              clientId={client.id}
              steps={steps.map((s) => ({ key: s.key, auto: s.auto, doneAt: s.doneAt }))}
            />
          </Card>

          <Card title={t("billing.agency.title")}>
            {billing ? (
              <SubscriptionPanel
                clientId={client.id}
                initial={{
                  modules: billing.state.modules.filter(isAddonKey),
                  adClient: billing.state.adClient,
                  discountPct: billing.state.discountBp / 100,
                  email: billing.state.email ?? client.email ?? "",
                  seats: billing.state.seats,
                  status: billing.status,
                  hasSubscription:
                    Boolean(billing.state.subscriptionId) && billing.status !== "canceled",
                  stripeEnabled: billing.stripeEnabled,
                  lastError: billing.lastError,
                  requests: billing.requests,
                }}
              />
            ) : user?.isPlatformAdmin ? (
              <CreateCrmWizard clientId={client.id} />
            ) : (
              <p className="text-ink-soft text-sm">{t("billing.agency.noCrm")}</p>
            )}
          </Card>

          <Card title={t("agency.client.details")}>
            <dl className="grid gap-2 text-sm">
              {details.map(([label, value]) => (
                <div key={label} className="grid grid-cols-[8.5rem_minmax(0,1fr)] gap-2">
                  <dt className="text-ink-soft">{t(label)}</dt>
                  <dd className="break-words">{value || "—"}</dd>
                </div>
              ))}
            </dl>
            {client.note ? (
              <p className="border-line mt-3 border-t pt-3 text-sm whitespace-pre-wrap">
                {client.note}
              </p>
            ) : null}
            {client.lead_id ? (
              <Link
                href={`/leady/${client.lead_id}`}
                className="text-ink-soft mt-3 block text-sm underline"
              >
                {t("agency.client.fromLead")}
              </Link>
            ) : null}
          </Card>
        </div>
      </div>
    </>
  );
}
