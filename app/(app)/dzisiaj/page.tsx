import type { Metadata } from "next";
import { Check } from "lucide-react";
import { Card, PageHeader, Stat } from "@/components/app-shell/page";
import { WaitingTickets } from "@/components/leads/waiting-tickets";
import { LiveUpdates } from "@/components/leads/live-updates";
import { getTodayData } from "@/lib/leads/dashboard";
import { SeasonStrip } from "@/components/season/season-strip";
import { requireOrganization } from "@/lib/auth/session";
import { buildSeason, countSaturdays, formatWaiting } from "@/lib/season";
import { t, type MessageKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: t("nav.today") };

const STEPS: { key: MessageKey; done: boolean }[] = [
  { key: "today.steps.company", done: true },
  { key: "today.steps.branding", done: false },
  { key: "today.steps.form", done: false },
  { key: "today.steps.notifications", done: false },
  { key: "today.steps.contract", done: false },
];

export default async function TodayPage() {
  const { organization } = await requireOrganization();
  const data = await getTodayData();
  const year = data.year;
  const season = buildSeason(year, data.inquiries);
  const steps = STEPS.map((step) =>
    step.key === "today.steps.form" ? { ...step, done: data.form_connected } : step,
  );
  const doneCount = steps.filter((step) => step.done).length;

  return (
    <>
      <PageHeader
        title={t("today.seasonTitle", { year })}
        subtitle={t("today.seasonSubtitle")}
        aside={
          <div className="flex gap-7 lg:gap-8 lg:text-right">
            <Stat value={String(data.waiting_count)} label={t("today.statWaiting")} />
            <Stat
              value={
                data.response_minutes === null
                  ? "—"
                  : formatWaiting(Math.round(data.response_minutes))
              }
              label={t("today.statResponse")}
            />
            <Stat value={String(countSaturdays(season, "booked"))} label={t("today.statBooked")} />
          </div>
        }
      />

      <SeasonStrip season={season} />

      <div className="mt-8 mb-3.5 flex items-baseline justify-between gap-3">
        <h2 className="font-display text-[22px] font-medium">{t("today.waitingTitle")}</h2>
        <p className="text-ink-soft hidden text-sm sm:block">{t("today.waitingHint")}</p>
      </div>
      <WaitingTickets leads={data.waiting} now={data.now} total={data.waiting_count} />

      <div className="mt-8 grid gap-5 lg:grid-cols-[1.3fr_1fr]">
        <Card title={t("today.checklistTitle")}>
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-ink-soft text-sm">{t("today.checklistSubtitle")}</p>
            <p className="text-ink-soft text-sm font-bold">
              {doneCount} / {STEPS.length}
            </p>
          </div>
          {/* Шаги — настоящая последовательность настройки, поэтому нумерация уместна. */}
          <ol className="mt-3">
            {steps.map((step, i) => (
              <li key={step.key} className="border-line flex items-center gap-4 border-t py-3">
                <span
                  className={cn(
                    "flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-bold",
                    step.done ? "bg-ok text-bg" : "border-line-strong text-ink-soft border-[1.5px]",
                  )}
                >
                  {step.done ? <Check className="size-4" aria-label={t("today.done")} /> : i + 1}
                </span>
                <span className={cn("flex-1 font-bold", step.done && "text-ink-soft line-through")}>
                  {t(step.key)}
                </span>
                {!step.done ? (
                  <span className="bg-surface-2 text-ink-soft rounded-full px-2.5 py-1 text-xs font-bold">
                    {t("common.soon")}
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
        </Card>

        <Card title={t("today.monthTitle")}>
          <div className="mt-3 grid grid-cols-2 gap-x-5 gap-y-6">
            <BigStat value={String(data.month_leads)} label={t("today.monthLeads")} />
            <BigStat value="—" label={t("today.monthConversion")} />
            <BigStat value={String(data.month_won)} label={t("today.monthDeposits")} />
            <BigStat value={String(data.followups)} label={t("today.monthFollowups")} />
          </div>
        </Card>
      </div>
      <div className="mt-6">
        <LiveUpdates organizationId={organization.id} />
      </div>
    </>
  );
}

function BigStat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <p className="font-display text-[40px] leading-none font-semibold">{value}</p>
      <p className="text-ink-soft mt-1.5 text-sm">{label}</p>
    </div>
  );
}
