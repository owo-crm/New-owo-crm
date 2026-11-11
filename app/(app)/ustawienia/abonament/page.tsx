import type { Metadata } from "next";
import { Check } from "lucide-react";
import { Card, PageHeader } from "@/components/app-shell/page";
import { PortalButton } from "@/components/billing/portal-button";
import { PriceTable } from "@/components/billing/price-table";
import { RequestModuleButton } from "@/components/billing/request-module-button";
import { requireOrganization } from "@/lib/auth/session";
import { ADDON_KEYS, MODULES } from "@/lib/billing/modules";
import { getBillingView } from "@/lib/billing/repository";
import { formatMoney } from "@/lib/finance/money";
import { plDateTime } from "@/lib/format";
import { t, type MessageKey } from "@/lib/i18n";

export const metadata: Metadata = { title: t("billing.settings.title") };

/** Абонемент глазами клиента: модули, цена, статус оплаты, портал Stripe. */
export default async function SubscriptionPage() {
  const { organization } = await requireOrganization();
  // Своё бизнес-членство проверено requireOrganization — читать можно.
  const view = await getBillingView(organization.id);
  if (!view) return null;
  const canManage = organization.role !== "member";
  return (
    <div className="max-w-3xl">
      <PageHeader title={t("billing.settings.title")} subtitle={t("billing.settings.intro")} />
      <div className="grid gap-5">
        <Card title={t("billing.agency.modules")}>
          <ul className="divide-line divide-y" data-testid="module-list">
            {(["leads", ...ADDON_KEYS] as const).map((key) => {
              const on = view.state.modules.includes(key) || key === "leads";
              return (
                <li
                  key={key}
                  className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0"
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 font-bold">
                      {on ? <Check className="text-ok size-4" aria-hidden /> : null}
                      {t(MODULES[key].labelKey)}
                    </span>
                    <span className="text-ink-soft block text-[13px]">
                      {t(MODULES[key].descriptionKey)}
                    </span>
                  </span>
                  {on ? null : (
                    <span className="flex items-center gap-3">
                      <span className="text-ink-soft text-[13px]">
                        {t("billing.locked.price", {
                          amount: formatMoney(MODULES[key].priceGrosze),
                        })}
                      </span>
                      <RequestModuleButton module={key} requested={view.requests.includes(key)} />
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
        <Card title={t("billing.settings.monthly")}>
          <p className="text-ink-soft mb-3 text-sm">
            {t("billing.settings.status")}:{" "}
            <b className="text-ink">{t(`billing.status.${view.status}` as MessageKey)}</b>
            {view.periodEnd ? ` · ${plDateTime(view.periodEnd)}` : ""} ·{" "}
            {t("billing.settings.seats", { count: Math.max(1, view.state.seats) })}
          </p>
          <PriceTable price={view.price} />
          {canManage && view.stripeEnabled && view.state.customerId ? (
            <div className="mt-4">
              <PortalButton />
            </div>
          ) : !view.state.customerId ? (
            <p className="text-ink-faint mt-3 text-[13px]">{t("billing.settings.notConnected")}</p>
          ) : null}
        </Card>
      </div>
    </div>
  );
}
