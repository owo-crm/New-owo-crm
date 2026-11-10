import Link from "next/link";
import { hasKnownResponse } from "@/lib/leads/response";
import { formatWaiting } from "@/lib/format";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { Lead, PipelineStage } from "@/lib/leads/types";

export function eventDateLabel(date: string | null) {
  return date ? date.split("-").reverse().join(".") : t("leads.noDate");
}

export function stageClass(kind?: string) {
  return kind === "won"
    ? "badge badge-won"
    : kind === "lost"
      ? "badge badge-lost"
      : "badge badge-open";
}

/** Сколько лид ждёт первого ответа. Null = ответ уже был. */
export function waitingMinutes(lead: Lead, now: number) {
  if (hasKnownResponse(lead)) return null;
  return Math.max(0, Math.round((now - Date.parse(lead.created_at)) / 60000));
}

/**
 * Список лидов — плотная таблица: за один взгляд видно, кто ждёт дольше всех,
 * что за событие, на каком этапе и кто ведёт. Строка целиком — ссылка на карточку.
 */
export function LeadList({
  leads,
  stages,
  team,
  now,
}: {
  leads: Lead[];
  stages: PipelineStage[];
  team: { id: string; name: string }[];
  now: string;
}) {
  const time = Date.parse(now);
  return (
    <div className="border-line bg-surface card-shadow overflow-hidden rounded-2xl border">
      <div className="text-ink-faint border-line hidden border-b px-4 py-2.5 text-xs font-bold md:grid md:grid-cols-[minmax(0,2.2fr)_minmax(0,1.6fr)_11rem_7rem] md:gap-4">
        <span>{t("leads.colLead")}</span>
        <span>{t("leads.colEvent")}</span>
        <span>{t("leads.colStage")}</span>
        <span className="text-right">{t("leads.colOwner")}</span>
      </div>
      <ul>
        {leads.map((lead) => {
          const stage = stages.find((s) => s.key === lead.stage_key);
          const waiting = waitingMinutes(lead, time);
          const owner = team.find((m) => m.id === lead.assigned_to)?.name;
          return (
            <li key={lead.id} className="border-line border-b last:border-0">
              <Link
                href={`/leady/${lead.id}`}
                className="hover:bg-surface-2 grid gap-x-4 gap-y-2 px-4 py-3 md:grid-cols-[minmax(0,2.2fr)_minmax(0,1.6fr)_11rem_7rem] md:items-center"
              >
                <div className="min-w-0">
                  <p className="truncate font-bold">{lead.client_name}</p>
                  <p className="text-ink-soft truncate text-[13px]">
                    {lead.phone_e164 || lead.email || t("leads.noContact")} · #{lead.number} ·{" "}
                    {lead.source_label}
                  </p>
                </div>
                <div className="min-w-0 text-[13px]">
                  <p
                    className={cn("truncate", lead.event_date ? "font-semibold" : "text-ink-faint")}
                  >
                    {eventDateLabel(lead.event_date)}
                  </p>
                  <p className="text-ink-soft truncate">
                    {[lead.event_type, lead.event_city].filter(Boolean).join(" · ") ||
                      t("leads.noDetails")}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={stageClass(stage?.kind)}>
                    {stage?.label_pl ?? lead.stage_key}
                  </span>
                  {waiting !== null && stage?.kind === "open" ? (
                    <span className="text-urgent text-[13px] font-bold tabular-nums">
                      {formatWaiting(waiting)}
                    </span>
                  ) : null}
                </div>
                {/* На телефоне «ничей» лид не занимает строку — показываем только опекуна. */}
                <p
                  className={cn(
                    "truncate text-[13px] md:text-right",
                    owner ? "text-ink-soft" : "text-ink-faint max-md:hidden",
                  )}
                >
                  {owner ?? t("leads.unassigned")}
                </p>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
