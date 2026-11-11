import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CalendarDays, Check, Phone } from "lucide-react";
import { Card, PageHeader } from "@/components/app-shell/page";
import { QueueRow } from "@/components/leads/queue";
import { LiveUpdates } from "@/components/leads/live-updates";
import { buttonVariants } from "@/components/ui/button";
import { getWorkQueue } from "@/lib/leads/dashboard";
import { requireOrganization } from "@/lib/auth/session";
import { formatWaiting, plDate, plDateTime } from "@/lib/format";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: t("today.title") };

export default async function TodayPage() {
  const { organization } = await requireOrganization();
  const q = await getWorkQueue();

  const stats = [
    { value: String(q.waiting_count), label: t("today.statWaiting"), urgent: q.waiting_count > 0 },
    {
      value: q.response_minutes === null ? "—" : formatWaiting(Math.round(q.response_minutes)),
      label: t("today.statResponse"),
    },
    { value: String(q.mine_count), label: t("today.statMine") },
    { value: String(q.month_leads), label: t("today.statMonth") },
    { value: String(q.month_won), label: t("today.statWon") },
  ];

  return (
    <>
      <PageHeader
        title={t("today.title")}
        subtitle={t("today.hello")}
        aside={<LiveUpdates organizationId={organization.id} />}
      />

      <div className="border-line bg-surface card-shadow mb-5 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border sm:grid-cols-3 lg:grid-cols-5">
        {stats.map((s) => (
          <div key={s.label} className="bg-surface px-4 py-3.5">
            <p
              className={cn(
                "font-display text-[1.75rem] leading-none font-semibold tabular-nums",
                s.urgent && "text-urgent",
              )}
            >
              {s.value}
            </p>
            <p className="text-ink-soft mt-1.5 text-[13px]">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Card>
          <div className="mb-1 flex items-baseline justify-between gap-3">
            <h2 className="text-[15px] font-bold">{t("today.queueTitle")}</h2>
            <span className="text-ink-faint text-xs">{t("today.queueOlder")}</span>
          </div>
          {q.waiting.length === 0 ? (
            <p className="text-ink-soft py-6 text-center text-sm">{t("today.queueEmpty")}</p>
          ) : (
            <>
              <ul>
                {q.waiting.map((lead) => (
                  <QueueRow key={lead.id} lead={lead} now={q.now} />
                ))}
              </ul>
              {q.waiting_count > q.waiting.length ? (
                <Link
                  href="/leady?quick=waiting"
                  className="text-ink-soft hover:text-ink mt-3 inline-flex items-center gap-1.5 text-sm font-bold"
                >
                  {t("today.seeAll", { count: q.waiting_count })}
                  <ArrowRight className="size-4" />
                </Link>
              ) : null}
            </>
          )}
        </Card>

        <div className="grid gap-5">
          <Card title={t("today.tasksTitle")}>
            {q.tasks.length === 0 ? (
              <p className="text-ink-soft text-sm">{t("today.tasksEmpty")}</p>
            ) : (
              <ul className="divide-line divide-y">
                {q.tasks.map((task, i) => (
                  <li
                    key={`${task.id}-${i}`}
                    className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0"
                  >
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/leady/${task.id}`}
                        className="truncate font-bold hover:underline"
                      >
                        {task.client_name}
                      </Link>
                      <p className="text-ink-soft truncate text-[13px]">
                        {plDateTime(task.due_at)} · {task.title || t("today.taskDefault")}
                      </p>
                    </div>
                    {task.phone_e164 ? (
                      <a
                        href={`tel:${task.phone_e164}`}
                        aria-label={`${t("today.call")} ${task.client_name}`}
                        className="text-ink-soft hover:text-ink flex size-9 items-center justify-center rounded-lg"
                      >
                        <Phone className="size-4" />
                      </a>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <div className="mb-1 flex items-baseline justify-between gap-3">
              <h2 className="text-[15px] font-bold">{t("today.upcomingTitle")}</h2>
              {organization.modules.includes("calendar") ? (
                <Link href="/kalendarz" className="text-ink-soft hover:text-ink text-xs font-bold">
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
                      <Link href={`/leady/${e.id}`} className="truncate font-bold hover:underline">
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
                      className="hover:bg-surface-2 -mx-2 flex items-center gap-2.5 rounded-lg px-2 py-2 text-sm font-bold"
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
