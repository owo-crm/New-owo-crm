import Link from "next/link";
import { monthGrid, plDate } from "@/lib/format";
import type { CalendarEvent } from "@/lib/leads/dashboard";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const WEEKDAYS = ["pon", "wt", "śr", "czw", "pt", "sob", "ndz"];

/**
 * Месяц занятости: подтверждённое событие (договор подписан) — залитый блок,
 * предварительное — пунктир. Пустой день означает, что дата свободна.
 */
export function MonthCalendar({
  month,
  events,
  today,
}: {
  month: string;
  events: CalendarEvent[];
  today: string;
}) {
  const byDate = new Map<string, CalendarEvent[]>();
  for (const e of events) byDate.set(e.event_date, [...(byDate.get(e.event_date) ?? []), e]);
  return (
    <div className="border-line bg-surface card-shadow overflow-hidden rounded-2xl border">
      <div className="text-ink-faint border-line grid grid-cols-7 border-b text-center text-xs font-bold">
        {WEEKDAYS.map((d) => (
          <span key={d} className="py-2">
            {d}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {monthGrid(month)
          .flat()
          .map((cell) => {
            const dayEvents = byDate.get(cell.iso) ?? [];
            const isToday = cell.iso === today;
            return (
              <div
                key={cell.iso}
                className={cn(
                  "border-line min-h-[5.5rem] border-r border-b p-1.5 [&:nth-child(7n)]:border-r-0",
                  !cell.inMonth && "bg-surface-2/60",
                )}
              >
                <span
                  className={cn(
                    "flex size-6 items-center justify-center rounded-full text-xs font-bold tabular-nums",
                    isToday ? "bg-ink text-bg" : cell.inMonth ? "text-ink-soft" : "text-ink-faint",
                  )}
                >
                  {cell.day}
                </span>
                <ul className="mt-1 grid gap-1">
                  {dayEvents.slice(0, 3).map((e) => (
                    <li key={e.id}>
                      <Link
                        href={`/leady/${e.id}`}
                        title={`${e.client_name}${e.event_city ? ` · ${e.event_city}` : ""}`}
                        className={cn(
                          "block truncate rounded px-1.5 py-0.5 text-[11px] leading-4 font-bold",
                          e.confirmed
                            ? "bg-ok/15 text-ok"
                            : "border-hold/40 text-hold border border-dashed",
                        )}
                      >
                        {e.client_name}
                      </Link>
                    </li>
                  ))}
                  {dayEvents.length > 3 ? (
                    <li className="text-ink-faint px-1.5 text-[11px] font-bold">
                      +{dayEvents.length - 3}
                    </li>
                  ) : null}
                </ul>
              </div>
            );
          })}
      </div>
    </div>
  );
}

/** На телефоне сетка слишком мелкая — показываем тот же месяц списком. */
export function MonthList({ events }: { events: CalendarEvent[] }) {
  return (
    <ul className="border-line bg-surface card-shadow divide-line divide-y overflow-hidden rounded-2xl border">
      {events.map((e) => (
        <li key={e.id}>
          <Link
            href={`/leady/${e.id}`}
            className="hover:bg-surface-2 flex items-center gap-3 px-4 py-3"
          >
            <span className="font-display w-14 shrink-0 text-sm font-semibold tabular-nums">
              {plDate(e.event_date).slice(0, 5)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-bold">{e.client_name}</span>
              <span className="text-ink-soft block truncate text-[13px]">
                {[e.event_type, e.event_city].filter(Boolean).join(" · ") || t("leads.noDetails")}
              </span>
            </span>
            <span className={e.confirmed ? "badge badge-won" : "badge badge-open"}>
              {t(e.confirmed ? "calendar.confirmed" : "calendar.planned")}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
