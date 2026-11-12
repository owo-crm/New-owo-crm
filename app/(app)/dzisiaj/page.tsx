import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CalendarDays, Check, Hourglass, Inbox, Trophy } from "lucide-react";
import { StatCards } from "@/components/app-shell/stat-cards";
import { Card, PageHeader } from "@/components/app-shell/page";
import { LiveUpdates } from "@/components/leads/live-updates";
import { buttonVariants } from "@/components/ui/button";
import { RankedBars, StackedBars } from "@/components/charts/bars";
import { getWorkQueue } from "@/lib/leads/dashboard";
import { getDashboardCharts } from "@/lib/leads/charts";
import { requireOrganization } from "@/lib/auth/session";
import { plDate } from "@/lib/format";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: t("nav.dashboard") };

export default async function TodayPage() {
  const { organization } = await requireOrganization();
  const [q, charts] = await Promise.all([getWorkQueue(), getDashboardCharts()]);
  // Месяц в подписи столбика: «11.26» короче любого названия и не ломает вёрстку.
  const shortMonth = (m: string) => `${m.slice(5)}.${m.slice(2, 4)}`;

  const stats = [
    {
      value: String(q.waiting_count),
      label: t("today.statWaiting"),
      urgent: q.waiting_count > 0,
      icon: Hourglass,
      tone: "var(--urgent)",
    },
    { value: String(q.month_leads), label: t("today.statMonth"), icon: Inbox, tone: "var(--hold)" },
    { value: String(q.month_won), label: t("today.statWon"), icon: Trophy, tone: "var(--ok)" },
  ];

  return (
    <>
      <PageHeader
        title={t("nav.dashboard")}
        subtitle={t("today.hello")}
        aside={<LiveUpdates organizationId={organization.id} />}
      />

      <StatCards items={stats} />

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card title={t("today.chartFlow")}>
          <StackedBars
            rows={charts.months.map((m) => ({
              label: shortMonth(m.month),
              values: { won: m.won, rest: m.leads - m.won },
            }))}
            series={[
              { key: "won", label: t("today.chartFlowWon"), color: "var(--accent)" },
              {
                key: "rest",
                label: t("today.chartFlowLeads"),
                color: "color-mix(in oklab, var(--accent) 22%, var(--surface))",
              },
            ]}
            empty={t("today.chartEmpty")}
          />
        </Card>

        <Card>
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h2 className="text-[15px] font-semibold">{t("today.upcomingTitle")}</h2>
            {organization.modules.includes("calendar") ? (
              <Link
                href="/kalendarz"
                className="text-ink-soft hover:text-ink text-xs font-semibold"
              >
                {t("today.upcomingAll")}
              </Link>
            ) : null}
          </div>
          {q.upcoming.length === 0 ? (
            <p className="text-ink-soft text-sm">{t("today.upcomingEmpty")}</p>
          ) : (
            <ul className="divide-line divide-y">
              {q.upcoming.map((e) => (
                <li key={e.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                  <CalendarDays
                    className={cn("size-4 shrink-0", e.confirmed ? "text-ok" : "text-ink-faint")}
                  />
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/leady/${e.id}`}
                      className="truncate font-semibold hover:underline"
                    >
                      {e.client_name}
                    </Link>
                    <p className="text-ink-soft truncate text-[13px]">
                      {plDate(e.event_date)}
                      {[e.event_type, e.event_city].filter(Boolean).length
                        ? ` · ${[e.event_type, e.event_city].filter(Boolean).join(" · ")}`
                        : ""}
                    </p>
                  </div>
                  <span className={e.confirmed ? "badge badge-won" : "badge badge-open"}>
                    {t(e.confirmed ? "today.confirmed" : "today.planned")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title={t("today.chartAhead")}>
          <StackedBars
            rows={charts.ahead.map((m) => ({
              label: shortMonth(m.month),
              values: { confirmed: m.confirmed, tentative: m.tentative },
            }))}
            series={[
              { key: "confirmed", label: t("today.chartConfirmed"), color: "var(--ok)" },
              {
                key: "tentative",
                label: t("today.chartTentative"),
                color: "color-mix(in oklab, var(--ok) 24%, var(--surface))",
              },
            ]}
            empty={t("today.chartEmpty")}
          />
        </Card>

        <div className="grid gap-5">
          <Card title={t("today.chartSources")}>
            <RankedBars
              rows={charts.sources.map((s) => ({ label: s.source, value: s.leads }))}
              color="var(--accent)"
              empty={t("today.chartEmpty")}
            />
          </Card>

          {!q.form_connected ? (
            <Card title={t("today.setupTitle")}>
              <ul className="grid gap-2">
                {[
                  ["/ustawienia/zrodla", "today.setupForm"],
                  ["/ustawienia/zespol", "today.setupTeam"],
                  ["/ustawienia/import", "today.setupImport"],
                ].map(([href, label]) => (
                  <li key={href}>
                    <Link
                      href={href}
                      className="hover:bg-surface-2 -mx-2 flex items-center gap-2.5 rounded-lg px-2 py-2 text-sm font-semibold"
                    >
                      <Check className="text-ink-faint size-4" />
                      {t(label as "today.setupForm")}
                      <ArrowRight className="text-ink-faint ml-auto size-4" />
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>
      </div>
      <div className="mt-5 sm:hidden">
        <Link href="/leady/nowy" className={buttonVariants({ variant: "secondary" })}>
          {t("leads.addLead")}
        </Link>
      </div>
    </>
  );
}
