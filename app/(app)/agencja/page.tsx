import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Plus, UserPlus } from "lucide-react";
import { Card, PageHeader } from "@/components/app-shell/page";
import { buttonVariants } from "@/components/ui/button";
import { AgencyTabs } from "@/components/agency/tabs";
import { RepeatRetainersButton } from "@/components/agency/repeat-button";
import {
  DeleteExpenseButton,
  FundExpenseForm,
  PayoutButton,
} from "@/components/agency/fund-actions";
import { ClientStatusBadge, monthLabel } from "@/components/agency/labels";
import { getAgencySummary } from "@/lib/agency/repository";
import { MODULES, isAddonKey } from "@/lib/billing/modules";
import { formatMoney } from "@/lib/finance/money";
import { addMonths, plDate, warsawToday } from "@/lib/format";
import { t, type MessageKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { StatCards } from "@/components/app-shell/stat-cards";
import { AlarmClock, CircleCheck, Hourglass, ReceiptText } from "lucide-react";

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
    {
      value: formatMoney(data.invoiced_grosze),
      label: t("agency.stats.invoiced"),
      icon: ReceiptText,
      tone: "#8b6cf0",
    },
    {
      value: formatMoney(data.received_grosze),
      label: t("agency.stats.received"),
      icon: CircleCheck,
      tone: "var(--ok)",
    },
    {
      value: formatMoney(data.expected_grosze),
      label: t("agency.stats.expected"),
      icon: Hourglass,
      tone: "var(--info)",
    },
    {
      value: formatMoney(data.overdue_grosze),
      label: t("agency.stats.overdue"),
      urgent: data.overdue_grosze > 0,
      icon: AlarmClock,
      tone: "var(--urgent)",
    },
  ];
  const { totals, attention } = data;
  // Прямые расходы внешним подрядчикам (часть расходов оплачена партнёрам — она в их строках).
  const externalCosts =
    data.direct_costs_grosze - data.costs_to_people.reduce((sum, c) => sum + c.amount_grosze, 0);
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
            <AgencyTabs current="overview" />
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

      <StatCards items={stats} className="lg:grid-cols-4" />
      {data.ad_budget_grosze > 0 ? (
        <p className="text-ink-soft -mt-2 mb-5 text-[13px]">
          {t("agency.stats.adBudget", { amount: formatMoney(data.ad_budget_grosze) })}
        </p>
      ) : null}

      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="grid min-w-0 grid-cols-1 gap-5">
          <Card title={t("agency.split.title")}>
            <p className="text-ink-soft -mt-1 mb-3 text-[13px]">{t("agency.split.intro")}</p>
            {data.received_grosze === 0 ? (
              <p className="text-ink-soft text-[13.5px]">{t("agency.split.empty")}</p>
            ) : (
              <div className="-mx-1 overflow-x-auto px-1">
                <table className="w-full min-w-[36rem] text-[13.5px]" data-testid="agency-split">
                  <thead className="text-ink-faint text-[12px] font-medium">
                    <tr>
                      <th className="pb-2 text-left font-medium">{t("agency.split.colPerson")}</th>
                      <th className="pb-2 pl-4 text-right font-medium">
                        {t("agency.split.colSale")}
                      </th>
                      <th className="pb-2 pl-4 text-right font-medium">
                        {t("agency.split.colWork")}
                      </th>
                      <th className="pb-2 pl-4 text-right font-medium">
                        {t("agency.split.colCosts")}
                      </th>
                      <th className="pb-2 pl-4 text-right font-medium">
                        {t("agency.split.colTotal")}
                      </th>
                      <th className="pb-2 pl-4 text-right font-medium">
                        {t("agency.split.colPaid")}
                      </th>
                      <th className="w-28 pb-2" />
                    </tr>
                  </thead>
                  <tbody className="tabular-nums">
                    {data.people.map((p) => (
                      <tr key={p.userId} className="border-line border-t">
                        <td className="py-2 font-semibold">{data.nameOf(p.userId)}</td>
                        <td className="py-2 pl-4 text-right">{formatMoney(p.sale)}</td>
                        <td className="py-2 pl-4 text-right">{formatMoney(p.work)}</td>
                        <td className="text-ink-soft py-2 pl-4 text-right">
                          {formatMoney(p.costs)}
                        </td>
                        <td className="py-2 pl-4 text-right font-semibold">
                          {formatMoney(p.total)}
                        </td>
                        <td className="text-ink-soft py-2 pl-4 text-right">
                          {formatMoney(p.paid)}
                        </td>
                        <td className="py-1.5 text-right">
                          <PayoutButton
                            userId={p.userId}
                            month={month.slice(0, 7)}
                            remaining={p.total - p.paid}
                          />
                        </td>
                      </tr>
                    ))}
                    <tr className="border-line border-t">
                      <td className="py-2 font-semibold">{t("agency.split.company")}</td>
                      <td colSpan={3} className="text-ink-faint py-2 text-right text-[12px]">
                        {t("agency.split.companyHint")}
                      </td>
                      <td className="py-2 pl-4 text-right font-semibold">
                        {formatMoney(totals.companyGrosze)}
                      </td>
                      <td colSpan={2} />
                    </tr>
                    {totals.unassignedGrosze > 0 ? (
                      <tr className="border-line text-hold border-t">
                        <td className="py-2">
                          <span className="font-semibold">{t("agency.split.unassigned")}</span>
                          <span className="block text-[12px]">
                            {t("agency.split.unassignedHint")}
                          </span>
                        </td>
                        <td colSpan={3} />
                        <td className="py-2 pl-4 text-right font-semibold">
                          {formatMoney(totals.unassignedGrosze)}
                        </td>
                        <td colSpan={2} />
                      </tr>
                    ) : null}
                    {externalCosts > 0 ? (
                      <tr className="border-line text-ink-soft border-t">
                        <td className="py-2">{t("agency.split.costsExternal")}</td>
                        <td colSpan={3} />
                        <td className="py-2 pl-4 text-right">{formatMoney(externalCosts)}</td>
                        <td colSpan={2} />
                      </tr>
                    ) : null}
                    <tr className="border-ink border-t-2">
                      <td className="pt-2.5 font-semibold">{t("agency.split.total")}</td>
                      <td colSpan={3} />
                      <td className="pt-2.5 text-right text-[15px] font-semibold">
                        {formatMoney(totals.totalGrosze + data.direct_costs_grosze)}
                      </td>
                      <td colSpan={2} />
                    </tr>
                  </tbody>
                </table>
                {data.reconciliation !== 0 ? (
                  <p role="alert" className="text-urgent mt-3 text-[13px] font-semibold">
                    {t("agency.split.mismatch", { amount: formatMoney(data.reconciliation) })}
                  </p>
                ) : null}
              </div>
            )}
          </Card>

          <Card title={t("agency.fund.title")}>
            <div className="mb-4 grid grid-cols-3 gap-3">
              {[
                { label: t("agency.fund.in"), value: data.fund.month_in },
                { label: t("agency.fund.out"), value: data.fund.month_out },
                { label: t("agency.fund.balance"), value: data.fund.balance, strong: true },
              ].map((x) => (
                <div key={x.label}>
                  <p
                    className={cn(
                      "text-[18px] leading-none font-semibold tabular-nums",
                      x.value < 0 && "text-urgent",
                    )}
                  >
                    {formatMoney(x.value)}
                  </p>
                  <p className="text-ink-soft mt-1 text-[12px]">{x.label}</p>
                </div>
              ))}
            </div>
            {data.expenses.length > 0 ? (
              <ul className="divide-line mb-4 divide-y text-[13.5px]">
                {data.expenses.map((e) => (
                  <li key={e.id} className="flex items-center gap-3 py-1.5">
                    <span className="text-ink-faint w-20 shrink-0 tabular-nums">
                      {plDate(e.spent_on)}
                    </span>
                    <span className="min-w-0 flex-1 truncate">
                      {e.label}{" "}
                      <span className="text-ink-faint">
                        · {t(`agency.fund.categories.${e.category}` as MessageKey)}
                      </span>
                    </span>
                    <span className="tabular-nums">{formatMoney(e.amount_grosze)}</span>
                    <DeleteExpenseButton id={e.id} label={e.label} />
                  </li>
                ))}
              </ul>
            ) : null}
            <FundExpenseForm />
            <p className="text-ink-faint mt-3 text-[12px]">{t("agency.fund.hint")}</p>
          </Card>

          {data.by_source.length > 0 ? (
            <Card title={t("agency.sources.title")}>
              <ul className="grid gap-2">
                {data.by_source.map((x) => (
                  <li
                    key={x.source}
                    className="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-3 text-[13.5px]"
                  >
                    <span className="truncate">{x.source}</span>
                    <span className="bg-surface-2 h-1.5 rounded-full">
                      <span
                        className="bg-ink-soft block h-1.5 rounded-full"
                        style={{
                          width: `${Math.max(4, (x.amount_grosze / Math.max(1, data.received_grosze)) * 100)}%`,
                        }}
                      />
                    </span>
                    <span className="tabular-nums">{formatMoney(x.amount_grosze)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          <Card>
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-[13.5px] font-semibold">{t("agency.clients.title")}</h2>
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
                      className="hover:bg-surface-2 -mx-2 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-0.5 rounded-lg px-2 py-2.5 sm:grid-cols-[minmax(0,1fr)_6rem_7rem_5rem]"
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-semibold">{c.name}</span>
                        <span className="text-ink-soft text-[12px]">
                          {c.last_activity
                            ? `${t("agency.clients.colActivity")}: ${plDate(c.last_activity.slice(0, 10))}`
                            : null}
                        </span>
                      </span>
                      <span className="sm:order-none">
                        <ClientStatusBadge status={c.status} />
                      </span>
                      <span className="text-right font-semibold tabular-nums max-sm:col-start-1 max-sm:text-left">
                        {formatMoney(c.month_grosze)}
                      </span>
                      <span
                        className={cn(
                          "text-right text-[13px] tabular-nums",
                          c.setupDone === c.setupTotal ? "text-ok font-semibold" : "text-ink-soft",
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
                    <h3 className="text-urgent mb-1.5 text-[13px] font-semibold">
                      {t("agency.attention.overdue")}
                    </h3>
                    <ul className="grid gap-1.5">
                      {attention.overdue.map((o) => (
                        <li key={o.id} className="flex items-baseline justify-between gap-3">
                          <Link
                            href={`/agencja/klienci/${o.client_id}`}
                            className="min-w-0 hover:underline"
                          >
                            <span className="block truncate font-semibold">{o.client_name}</span>
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
                    <h3 className="mb-1.5 text-[13px] font-semibold">
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
                            className="truncate font-semibold hover:underline"
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
                    <h3 className="mb-1.5 text-[13px] font-semibold">
                      {t("agency.attention.noOrders")}
                    </h3>
                    <ul className="flex flex-wrap gap-1.5">
                      {attention.noOrders.map((c) => (
                        <li key={c.id}>
                          <Link
                            href={`/agencja/zlecenia/nowe?klient=${c.id}&m=${month.slice(0, 7)}`}
                            className="border-line-strong hover:border-ink-soft inline-flex h-8 items-center rounded-full border px-3 font-semibold"
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
                    <h3 className="mb-1.5 text-[13px] font-semibold">
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
