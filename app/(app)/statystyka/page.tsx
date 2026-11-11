import type { Metadata } from "next";
import { ModuleLocked } from "@/components/billing/module-locked";
import { moduleAccess } from "@/lib/billing/gate";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Card, PageHeader } from "@/components/app-shell/page";
import { buttonVariants } from "@/components/ui/button";
import { getFinanceSummary } from "@/lib/finance/summary";
import { formatMoney } from "@/lib/finance/money";
import { addMonths, plDate, warsawToday } from "@/lib/format";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: t("finance.pageTitle") };

const MONTHS = [
  "styczeń",
  "luty",
  "marzec",
  "kwiecień",
  "maj",
  "czerwiec",
  "lipiec",
  "sierpień",
  "wrzesień",
  "październik",
  "listopad",
  "grudzień",
];

export default async function FinancePage({ searchParams }: PageProps<"/statystyka">) {
  // Модуль абонемента выключен → экран «Poproś o moduł» (решение 022).
  const access = await moduleAccess("payments");
  if (!access.enabled)
    return (
      <>
        <PageHeader title={t("finance.pageTitle")} />
        <ModuleLocked module="payments" requested={access.requested} />
      </>
    );
  const raw = (await searchParams).m;
  const today = warsawToday();
  const month =
    typeof raw === "string" && /^\d{4}-\d{2}$/.test(raw) ? `${raw}-01` : `${today.slice(0, 7)}-01`;
  const data = await getFinanceSummary(month);
  const [year, m] = month.split("-").map(Number);
  const link = (iso: string) => `/statystyka?m=${iso.slice(0, 7)}`;

  const stats = [
    { value: formatMoney(data.paid_grosze), label: t("finance.statPaid") },
    { value: formatMoney(data.expected_grosze), label: t("finance.statExpected") },
    {
      value: formatMoney(data.overdue_grosze),
      label: t("finance.statOverdue"),
      urgent: data.overdue_grosze > 0,
    },
    { value: formatMoney(data.signed_grosze), label: t("finance.statSigned") },
  ];
  const maxMonth = Math.max(1, ...data.months.map((x) => x.paid_grosze));
  const maxStage = Math.max(1, ...data.funnel.map((s) => s.leads));

  return (
    <>
      <PageHeader
        title={`${t("finance.pageTitle")} · ${MONTHS[m - 1]} ${year}`}
        subtitle={t("finance.pageIntro")}
        aside={
          <div className="flex items-center gap-2">
            <Link
              href={link(addMonths(month, -1))}
              aria-label={t("finance.prev")}
              className={buttonVariants({ variant: "secondary", size: "icon" })}
            >
              <ChevronLeft className="size-4" />
            </Link>
            <Link href="/statystyka" className={buttonVariants({ variant: "secondary" })}>
              {t("finance.current")}
            </Link>
            <Link
              href={link(addMonths(month, 1))}
              aria-label={t("finance.next")}
              className={buttonVariants({ variant: "secondary", size: "icon" })}
            >
              <ChevronRight className="size-4" />
            </Link>
          </div>
        }
      />

      <div className="border-line bg-surface card-shadow mb-5 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border lg:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="bg-surface px-4 py-3.5">
            <p
              className={cn(
                "font-display text-[1.6rem] leading-none font-semibold tabular-nums",
                s.urgent && "text-urgent",
              )}
            >
              {s.value}
            </p>
            <p className="text-ink-soft mt-1.5 text-[13px]">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-2">
        <Card title={t("finance.overdueTitle")}>
          {data.overdue.length === 0 ? (
            <p className="text-ink-soft text-sm">{t("finance.overdueEmpty")}</p>
          ) : (
            <ul className="divide-line divide-y">
              {data.overdue.map((p) => (
                <li key={p.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/leady/${p.lead_id}`}
                      className="truncate font-bold hover:underline"
                    >
                      {p.client_name}
                    </Link>
                    <p className="text-urgent text-[13px] font-bold">
                      {p.label} · {t("finance.wasDue", { date: plDate(p.due_date) })}
                    </p>
                  </div>
                  <span className="font-display shrink-0 font-semibold tabular-nums">
                    {formatMoney(p.amount_grosze)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title={t("finance.upcomingTitle")}>
          {data.upcoming.length === 0 ? (
            <p className="text-ink-soft text-sm">{t("finance.upcomingEmpty")}</p>
          ) : (
            <ul className="divide-line divide-y">
              {data.upcoming.map((p) => (
                <li key={p.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/leady/${p.lead_id}`}
                      className="truncate font-bold hover:underline"
                    >
                      {p.client_name}
                    </Link>
                    <p className="text-ink-soft text-[13px]">
                      {p.label} · {t("finance.due", { date: plDate(p.due_date) })}
                    </p>
                  </div>
                  <span className="font-display shrink-0 font-semibold tabular-nums">
                    {formatMoney(p.amount_grosze)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title={t("finance.sourcesTitle")}>
          {data.by_source.length === 0 ? (
            <p className="text-ink-soft text-sm">{t("finance.sourcesEmpty")}</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-ink-faint text-xs font-bold">
                <tr>
                  <th className="pb-2 text-left">{t("finance.colSource")}</th>
                  <th className="pb-2 text-right">{t("finance.colLeads")}</th>
                  <th className="pb-2 text-right">{t("finance.colPaid")}</th>
                  <th className="pb-2 text-right">{t("finance.colOpen")}</th>
                </tr>
              </thead>
              <tbody>
                {data.by_source.map((s) => (
                  <tr key={s.source} className="border-line border-t">
                    <td className="py-2 font-bold">{s.source}</td>
                    <td className="py-2 text-right tabular-nums">{s.leads}</td>
                    <td className="py-2 text-right tabular-nums">{formatMoney(s.paid_grosze)}</td>
                    <td className="text-ink-soft py-2 text-right tabular-nums">
                      {formatMoney(s.open_grosze)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <div className="grid gap-5">
          <Card title={t("finance.monthsTitle")}>
            {data.months.length === 0 ? (
              <p className="text-ink-soft text-sm">{t("finance.sourcesEmpty")}</p>
            ) : (
              <ul className="grid gap-2">
                {data.months.map((x) => (
                  <li
                    key={x.month}
                    className="grid grid-cols-[4rem_1fr_auto] items-center gap-3 text-sm"
                  >
                    <span className="text-ink-soft tabular-nums">{x.month}</span>
                    <span className="bg-surface-2 h-2 rounded-full">
                      <span
                        className="bg-brand block h-2 rounded-full"
                        style={{ width: `${Math.max(4, (x.paid_grosze / maxMonth) * 100)}%` }}
                      />
                    </span>
                    <span className="tabular-nums">{formatMoney(x.paid_grosze)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title={t("finance.funnelTitle")}>
            <ul className="grid gap-2">
              {data.funnel.map((s) => (
                <li
                  key={s.key}
                  className="grid grid-cols-[9rem_1fr_2rem] items-center gap-3 text-sm"
                >
                  <span className="text-ink-soft truncate">{s.label}</span>
                  <span className="bg-surface-2 h-2 rounded-full">
                    <span
                      className={cn(
                        "block h-2 rounded-full",
                        s.kind === "won"
                          ? "bg-ok"
                          : s.kind === "lost"
                            ? "bg-ink-faint"
                            : "bg-brand",
                      )}
                      style={{ width: `${Math.max(2, (s.leads / maxStage) * 100)}%` }}
                    />
                  </span>
                  <span className="text-right tabular-nums">{s.leads}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
