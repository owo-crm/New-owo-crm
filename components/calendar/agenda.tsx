import Link from "next/link";
import { CalendarDays } from "lucide-react";
import { EmptyState } from "@/components/app-shell/page";
import type { CalendarEvent } from "@/lib/leads/dashboard";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * Календарь — список дат, а не сетка месяца (решение 034).
 *
 * Сетка на тридцать клеток показывала в основном пустоту: занятых дней у выездной
 * фирмы единицы. Здесь только те дни, когда кто-то едет — подписанные и ещё не
 * подписанные рядом, чтобы было видно, где дата занята твёрдо, а где только намечена.
 */

const WEEKDAYS = ["niedziela", "poniedziałek", "wtorek", "środa", "czwartek", "piątek", "sobota"];
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

type Day = { date: string; events: CalendarEvent[] };
type Month = { key: string; label: string; days: Day[] };

export function groupByMonth(events: CalendarEvent[]): Month[] {
  const months = new Map<string, Map<string, CalendarEvent[]>>();
  for (const e of events) {
    const key = e.event_date.slice(0, 7);
    const days = months.get(key) ?? new Map<string, CalendarEvent[]>();
    days.set(e.event_date, [...(days.get(e.event_date) ?? []), e]);
    months.set(key, days);
  }
  return [...months.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, days]) => ({
      key,
      label: `${MONTHS[Number(key.slice(5)) - 1]} ${key.slice(0, 4)}`,
      days: [...days.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, list]) => ({ date, events: list })),
    }));
}

export function Agenda({ events, today }: { events: CalendarEvent[]; today: string }) {
  const months = groupByMonth(events);
  if (!months.length)
    return (
      <EmptyState
        icon={CalendarDays}
        title={t("calendar.emptyTitle")}
        text={t("calendar.emptyText")}
      />
    );

  return (
    <div className="grid gap-7">
      {months.map((month) => (
        <section key={month.key}>
          <h2 className="text-ink-soft mb-2 text-[13px] font-semibold">
            {month.label}
            <span className="text-ink-faint ml-2 font-normal">
              {t("calendar.monthCount", {
                days: month.days.length,
                events: month.days.reduce((n, d) => n + d.events.length, 0),
              })}
            </span>
          </h2>
          <ul className="grid gap-2">
            {month.days.map((day) => {
              const d = new Date(`${day.date}T12:00:00`);
              const signed = day.events.some((e) => e.confirmed);
              const isToday = day.date === today;
              return (
                <li
                  key={day.date}
                  className={cn(
                    "border-line bg-surface grid gap-3 rounded-xl border p-3 sm:grid-cols-[4.5rem_1fr] sm:items-start sm:p-4",
                    // День с подписанной умовой выделен цветом слева: занят твёрдо.
                    signed ? "border-l-ok border-l-[3px]" : "border-l-hold border-l-[3px]",
                    isToday && "ring-accent/40 ring-2",
                  )}
                >
                  <div className="flex items-baseline gap-2 sm:block">
                    <span className="text-[22px] leading-none font-bold tabular-nums">
                      {day.date.slice(8)}
                    </span>
                    <span className="text-ink-faint text-[12.5px] sm:mt-1 sm:block">
                      {WEEKDAYS[d.getDay()]}
                    </span>
                  </div>
                  <ul className="divide-line grid divide-y">
                    {day.events.map((e) => (
                      <li key={e.id} className="py-1.5 first:pt-0 last:pb-0">
                        <Link
                          href={`/leady/${e.id}`}
                          className="flex flex-wrap items-center gap-x-3 gap-y-1"
                        >
                          <span className="min-w-0 flex-1 truncate font-semibold hover:underline">
                            {e.client_name}
                          </span>
                          <span className={e.confirmed ? "badge badge-won" : "badge badge-open"}>
                            {t(e.confirmed ? "today.confirmed" : "today.planned")}
                          </span>
                          {[e.event_type, e.event_city].filter(Boolean).length ? (
                            <span className="text-ink-soft w-full truncate text-[13px] sm:w-auto">
                              {[e.event_type, e.event_city].filter(Boolean).join(" · ")}
                            </span>
                          ) : null}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
