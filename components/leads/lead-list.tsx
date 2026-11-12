import Link from "next/link";
import { hasKnownResponse } from "@/lib/leads/response";
import { formatWaiting } from "@/lib/format";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
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

/** У каждого открытого этапа воронки свой мягкий цвет (по порядку); выиграно — зелёный, потеряно — серый. */
const STAGE_TONES = ["var(--info)", "#8b6cf0", "var(--hold)", "#2f9e8f", "#d65f9e", "#5b7cfa"];
export function stageTone(stage?: { kind: string; position: number }) {
  if (!stage) return "var(--ink-soft)";
  if (stage.kind === "won") return "var(--ok)";
  if (stage.kind === "lost") return "var(--ink-faint)";
  return STAGE_TONES[stage.position % STAGE_TONES.length];
}

export function StageBadge({
  stage,
  label,
}: {
  stage?: { kind: string; position: number };
  label: string;
}) {
  return (
    <span className="badge" style={{ "--badge": stageTone(stage) } as React.CSSProperties}>
      <span className="size-1.5 rounded-full bg-current" aria-hidden />
      {label}
    </span>
  );
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
    <div className="border-line bg-surface overflow-hidden rounded-2xl border shadow-[var(--shadow)]">
      <div className="text-ink-faint border-line bg-surface-2/60 hidden border-b px-4 py-2.5 text-[12px] font-medium md:grid md:grid-cols-[minmax(0,2.2fr)_minmax(0,1.6fr)_11rem_7rem] md:gap-4">
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
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar name={lead.client_name} size={34} />
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{lead.client_name}</p>
                    <p className="text-ink-soft truncate text-[13px]">
                      {lead.phone_e164 || lead.email || t("leads.noContact")} · #{lead.number} ·{" "}
                      {lead.source_label}
                    </p>
                  </div>
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
                  <StageBadge stage={stage} label={stage?.label_pl ?? lead.stage_key} />
                  {waiting !== null && stage?.kind === "open" ? (
                    <span className="text-urgent text-[13px] font-semibold tabular-nums">
                      {formatWaiting(waiting)}
                    </span>
                  ) : null}
                </div>
                {/* На телефоне «ничей» лид не занимает строку — показываем только опекуна. */}
                <p
                  className={cn(
                    "flex min-w-0 items-center gap-2 text-[13px] md:justify-end",
                    owner ? "text-ink-soft" : "text-ink-faint max-md:hidden",
                  )}
                >
                  {owner ? <Avatar name={owner} size={22} /> : null}
                  <span className="truncate">{owner ?? t("leads.unassigned")}</span>
                </p>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
