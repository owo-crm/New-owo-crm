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
import { StatCards } from "@/components/app-shell/stat-cards";
import { FileSignature, Hourglass, Wallet } from "lucide-react";

export const metadata: Metadata = { title: t("nav.stats") };

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
    {
      value: formatMoney(data.paid_grosze),
      label: t("finance.statPaid"),
      icon: Wallet,
      tone: "var(--ok)",
    },
    {
      value: formatMoney(data.expected_grosze),
      label: t("finance.statExpected"),
      icon: Hourglass,
      tone: "var(--info)",
    },
    {
      value: formatMoney(data.signed_grosze),
      label: t("finance.statSigned"),
      icon: FileSignature,
      tone: "#8b6cf0",
    },
  ];
  const maxMonth = Math.max(1, ...data.months.map((x) => x.paid_grosze));

  return (
    <>
      <PageHeader
        title={t("nav.stats")}
        aside={
          <div className="flex items-center gap-2">
            <span className="mr-1 text-[15px] font-semibold">
              {MONTHS[m - 1]} {year}
            </span>
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

      <StatCards items={stats} className="lg:grid-cols-3" />

      <div className="grid items-start gap-5 lg:grid-cols-2">
        <Card title={t("finance.sourcesTitle")}>
          {data.by_source.length === 0 ? (
            <p className="text-ink-soft text-sm">{t("finance.sourcesEmpty")}</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-ink-faint text-xs font-semibold">
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
                    <td className="py-2 font-semibold">{s.source}</td>
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
                        className="bg-ink-soft block h-2 rounded-full"
                        style={{ width: `${Math.max(4, (x.paid_grosze / maxMonth) * 100)}%` }}
                      />
                    </span>
                    <span className="tabular-nums">{formatMoney(x.paid_grosze)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
