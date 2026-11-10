import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { SaturdayStatus, SeasonMonth } from "@/lib/season";

const CELL: Record<SaturdayStatus, string> = {
  free: "bg-surface-2 text-ink-faint",
  booked: "bg-urgent text-white",
  hold: "bg-hold text-[#3a2604]",
  inquiry: "text-urgent outline-2 -outline-offset-2 outline-dashed outline-urgent",
};

const STATUS_LABEL: Record<SaturdayStatus, string> = {
  free: t("season.status.free"),
  booked: t("season.status.booked"),
  hold: t("season.status.hold"),
  inquiry: t("season.status.inquiry"),
};

/**
 * Полоса сезона: 12 месяцев × субботы. Каждая суббота окрашена по статусу.
 * На телефоне месяцы листаются вбок.
 */
export function SeasonStrip({ season }: { season: SeasonMonth[] }) {
  return (
    <section
      aria-labelledby="season-title"
      className="border-line bg-surface rounded-[22px] border px-4 py-5 sm:px-6 sm:py-6"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="season-title" className="font-display text-xl font-medium">
          {t("season.saturdays")}
        </h2>
        <ul className="text-ink-soft flex flex-wrap gap-x-4 gap-y-1 text-[13px] font-medium">
          {(["booked", "hold", "inquiry", "free"] as const).map((status) => (
            <li key={status} className="flex items-center gap-1.5">
              <span className={cn("inline-block size-[11px] rounded-[3px]", CELL[status])} />
              {STATUS_LABEL[status]}
            </li>
          ))}
        </ul>
      </div>

      <div className="-mx-4 mt-5 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <div className="grid min-w-[760px] grid-cols-12 gap-2.5">
          {season.map((month) => (
            <div key={month.month}>
              <h3 className="text-ink-soft mb-2 text-xs font-bold">{month.label}</h3>
              <ul className="grid gap-[5px]">
                {month.saturdays.map((s) => (
                  <li
                    key={s.iso}
                    data-date={s.iso}
                    data-status={s.status}
                    title={`${s.iso} · ${STATUS_LABEL[s.status]}`}
                    className={cn(
                      "flex h-[26px] items-center rounded-[7px] pl-[7px] text-[11px] font-bold",
                      CELL[s.status],
                    )}
                  >
                    {s.day}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
