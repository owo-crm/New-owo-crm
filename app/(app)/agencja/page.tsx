import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Plus, UserPlus } from "lucide-react";
import { Card, PageHeader } from "@/components/app-shell/page";
import { buttonVariants } from "@/components/ui/button";
import { RepeatRetainersButton } from "@/components/agency/repeat-button";
import { ClientStatusBadge, monthLabel } from "@/components/agency/labels";
import { getAgencySummary } from "@/lib/agency/repository";
import { MODULES, isAddonKey } from "@/lib/billing/modules";
import { formatMoney } from "@/lib/finance/money";
import { addMonths, plDate, warsawToday } from "@/lib/format";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: t("agency.pageTitle") };

/**
 * «Мозг» OWO Ads: деньги за месяц, раздел «кому сколько», клиенты и что требует внимания.
 * Переключение месяцев — как на /finanse (?m=YYYY-MM).
 */
export default async function AgencyPage({ searchParams }: PageProps<"/agencja">) {
  const raw = (await searchParams).m;
  const today = warsawToday();
  const month =
    typeof raw === "string" && /^\d{4}-\d{2}$/.test(raw) ? `${raw}-01` : `${today.slice(0, 7)}-01`;
  const data = await getAgencySummary(month);
  const link = (iso: string) => `/agencja?m=${iso.slice(0, 7)}`;

  const stats = [
    { value: data.invoiced_grosze, label: t("agency.stats.invoiced") },
    { value: data.received_grosze, label: t("agency.stats.received") },
    { value: data.expected_grosze, label: t("agency.stats.expected") },
    {
      value: data.overdue_grosze,
      label: t("agency.stats.overdue"),
      urgent: data.overdue_grosze > 0,
    },
  ];
  const { totals, attention } = data;
  const attentionCount =
    attention.overdue.length +
    attention.noOrders.length +
    attention.staleSetup.length +
    attention.requests.length;

  return (
    <>
      <PageHeader
        title={`${t("agency.pageTitle")} · ${monthLabel(month)}`}
        subtitle={t("agency.pageIntro")}
        aside={
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={link(addMonths(month, -1))}
              aria-label={t("finance.prev")}
              className={buttonVariants({ variant: "secondary", size: "icon" })}
            >
              <ChevronLeft className="size-4" />
            </Link>
            <Link href="/agencja" className={buttonVariants({ variant: "secondary" })}>
              {t("finance.current")}
            </Link>
            <Link
              href={link(addMonths(month, 1))}
              aria-label={t("finance.next")}
              className={buttonVariants({ variant: "secondary", size: "icon" })}
            >
              <ChevronRight className="size-4" />
            </Link>
            <Link
              href={`/agencja/zlecenia/nowe?m=${month.slice(0, 7)}`}
              className={buttonVariants({ variant: "primary" })}
            >
              <Plus />
              {t("agency.newOrder")}
            </Link>
          </div>
        }
      />

      <div className="border-line bg-surface card-shadow mb-5 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border lg:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="bg-surface px-4 py-3.5">
            <p
              className={cn(
                "font-display text-[clamp(1.2rem,4vw,1.6rem)] leading-none font-semibold tabular-nums",
                s.urgent && "text-urgent",
              )}
            >
              {formatMoney(s.value)}
            </p>
            <p className="text-ink-soft mt-1.5 text-[13px]">{s.label}</p>
          </div>
        ))}
      </div>
      {data.ad_budget_grosze > 0 ? (
        <p className="text-ink-soft -mt-2 mb-5 text-[13px]">
          {t("agency.stats.adBudget", { amount: formatMoney(data.ad_budget_grosze) })}
        </p>
      ) : null}

      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="grid min-w-0 grid-cols-1 gap-5">
          <Card title={t("agency.split.title")}>
            <p className="text-ink-soft -mt-1 mb-3 text-sm">{t("agency.split.intro")}</p>
            {data.received_grosze === 0 ? (
              <p className="text-ink-soft text-sm">{t("agency.split.empty")}</p>
            ) : (
              <div className="-mx-1 overflow-x-auto px-1">
                <table className="w-full min-w-[26rem] text-sm" data-testid="agency-split">
                  <thead className="text-ink-faint text-xs font-bold">
                    <tr>
                      <th className="pb-2 text-left">{t("agency.split.colPerson")}</th>
                      <th className="pb-2 text-right">{t("agency.split.colSale")}</th>
                      <th className="pb-2 text-right">{t("agency.split.colWork")}</th>
                      <th className="pb-2 text-right">{t("agency.split.colTotal")}</th>
                    </tr>
                  </thead>
                  <tbody className="tabular-nums">
                    {totals.people.map((p) => (
                      <tr key={p.userId} className="border-line border-t">
                        <td className="py-2 font-bold">{data.nameOf(p.userId)}</td>
                        <td className="py-2 text-right">{formatMoney(p.saleGrosze)}</td>
                        <td className="py-2 text-right">{formatMoney(p.workGrosze)}</td>
                        <td className="py-2 text-right font-bold">{formatMoney(p.totalGrosze)}</td>
                      </tr>
                    ))}
                    <tr className="border-line border-t">
                      <td className="py-2 font-bold">{t("agency.split.company")}</td>
                      <td />
                      <td />
                      <td className="py-2 text-right font-bold">
                        {formatMoney(totals.companyGrosze)}
                      </td>
                    </tr>
                    {totals.unassignedGrosze > 0 ? (
                      <tr className="border-line text-hold border-t">
                        <td className="py-2">
                          <span className="font-bold">{t("agency.split.unassigned")}</span>
                          <span className="block text-[12px]">
                            {t("agency.split.unassignedHint")}
                          </span>
                        </td>
                        <td />
                        <td />
                        <td className="py-2 text-right font-bold">
                          {formatMoney(totals.unassignedGrosze)}
                        </td>
                      </tr>
                    ) : null}
                    {data.direct_costs_grosze > 0 ? (
                      <tr className="border-line text-ink-soft border-t">
                        <td className="py-2">{t("agency.split.costs")}</td>
                        <td />
                        <td />
                        <td className="py-2 text-right">{formatMoney(data.direct_costs_grosze)}</td>
                      </tr>
                    ) : null}
                    <tr className="border-ink border-t-2">
                      <td className="pt-2.5 font-bold">{t("agency.split.total")}</td>
                      <td />
                      <td />
                      <td className="font-display pt-2.5 text-right text-base font-semibold">
                        {formatMoney(totals.totalGrosze + data.direct_costs_grosze)}
                      </td>
                    </tr>
                  </tbody>
                </table>
                {data.reconciliation !== 0 ? (
                  <p role="alert" className="text-urgent mt-3 text-sm font-bold">
                    {t("agency.split.mismatch", { amount: formatMoney(data.reconciliation) })}
                  </p>
                ) : null}
              </div>
            )}
          </Card>

          <Card>
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-[15px] font-bold">{t("agency.clients.title")}</h2>
              <Link
                href="/agencja/klienci/nowy"
                className={buttonVariants({ variant: "ghost", size: "sm" })}
              >
                <UserPlus />
                {t("agency.newClient")}
              </Link>
            </div>
            {data.clients.length === 0 ? (
              <p className="text-ink-soft text-sm">{t("agency.clients.empty")}</p>
            ) : (
              <ul className="divide-line divide-y" data-testid="agency-clients">
                {data.clients.map((c) => (
                  <li key={c.id}>
                    <Link
                      href={`/agencja/klienci/${c.id}`}
                      className="hover:bg-surface-2 -mx-2 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-0.5 rounded-[10px] px-2 py-2.5 sm:grid-cols-[minmax(0,1fr)_6rem_7rem_5rem]"
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-bold">{c.name}</span>
                        <span className="text-ink-soft text-[12px]">
                          {c.last_activity
                            ? `${t("agency.clients.colActivity")}: ${plDate(c.last_activity.slice(0, 10))}`
                            : null}
                        </span>
                      </span>
                      <span className="sm:order-none">
                        <ClientStatusBadge status={c.status} />
                      </span>
                      <span className="font-display text-right font-semibold tabular-nums max-sm:col-start-1 max-sm:text-left">
                        {formatMoney(c.month_grosze)}
                      </span>
                      <span
                        className={cn(
                          "text-right text-[13px] tabular-nums",
                          c.setupDone === c.setupTotal ? "text-ok font-bold" : "text-ink-soft",
                        )}
                        title={t("agency.clients.colSetup")}
                      >
                        {c.client_org_id
                          ? t("agency.clients.setup", { done: c.setupDone, total: c.setupTotal })
                          : t("agency.clients.noCrm")}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="grid gap-5">
          <Card title={t("agency.attention.title")}>
            {attentionCount === 0 ? (
              <p className="text-ink-soft text-sm">{t("agency.attention.empty")}</p>
            ) : (
              <div className="grid gap-4 text-sm">
                {attention.overdue.length > 0 ? (
                  <section>
                    <h3 className="text-urgent mb-1.5 text-[13px] font-bold">
                      {t("agency.attention.overdue")}
                    </h3>
                    <ul className="grid gap-1.5">
                      {attention.overdue.map((o) => (
                        <li key={o.id} className="flex items-baseline justify-between gap-3">
                          <Link
                            href={`/agencja/klienci/${o.client_id}`}
                            className="min-w-0 hover:underline"
                          >
                            <span className="block truncate font-bold">{o.client_name}</span>
                            <span className="text-ink-soft block truncate text-[12px]">
                              {o.title} ·{" "}
                              {t("agency.attention.wasDue", { date: plDate(o.due_date) })}
                            </span>
                          </Link>
                          <span className="shrink-0 tabular-nums">
                            {formatMoney(o.amount_grosze)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}
                {attention.requests.length > 0 ? (
                  <section>
                    <h3 className="mb-1.5 text-[13px] font-bold">
                      {t("agency.attention.requests")}
                    </h3>
                    <ul className="grid gap-1">
                      {attention.requests.map((r) => (
                        <li
                          key={`${r.client_id}-${r.module}`}
                          className="flex justify-between gap-3"
                        >
                          <Link
                            href={`/agencja/klienci/${r.client_id}`}
                            className="truncate font-bold hover:underline"
                          >
                            {r.name}
                          </Link>
                          <span className="text-ink-soft shrink-0">
                            {isAddonKey(r.module) ? t(MODULES[r.module].labelKey) : r.module}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}
                {attention.noOrders.length > 0 ? (
                  <section>
                    <h3 className="mb-1.5 text-[13px] font-bold">
                      {t("agency.attention.noOrders")}
                    </h3>
                    <ul className="flex flex-wrap gap-1.5">
                      {attention.noOrders.map((c) => (
                        <li key={c.id}>
                          <Link
                            href={`/agencja/zlecenia/nowe?klient=${c.id}&m=${month.slice(0, 7)}`}
                            className="border-line-strong hover:border-ink-soft inline-flex h-8 items-center rounded-full border px-3 font-bold"
                          >
                            {c.name}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}
                {attention.staleSetup.length > 0 ? (
                  <section>
                    <h3 className="mb-1.5 text-[13px] font-bold">
                      {t("agency.attention.staleSetup")}
                    </h3>
                    <ul className="grid gap-1">
                      {attention.staleSetup.map((c) => (
                        <li key={c.id} className="flex justify-between gap-3">
                          <Link
                            href={`/agencja/klienci/${c.id}`}
                            className="truncate hover:underline"
                          >
                            {c.name}
                          </Link>
                          <span className="text-ink-soft shrink-0 tabular-nums">
                            {t("agency.clients.setup", { done: c.setupDone, total: c.setupTotal })}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}
              </div>
            )}
          </Card>
          <RepeatRetainersButton month={month.slice(0, 7)} />
        </div>
      </div>
    </>
  );
}
