import { hasKnownResponse } from "@/lib/leads/response";
import { t } from "@/lib/i18n";
import { LeadCardRow } from "./lead-row";
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
 * Список лидов — карточки как в мобильном макете (решение 048): плитка события, этап,
 * «событие · дата», сколько прошло, стрелка. Ждущие ответа — с красной полосой слева.
 */
export function LeadList({
  leads,
  stages,
  now,
}: {
  leads: Lead[];
  stages: PipelineStage[];
  team?: { id: string; name: string }[];
  now: string;
}) {
  const time = Date.parse(now);
  return (
    <ul className="grid gap-2.5 xl:grid-cols-2" data-testid="lead-cards">
      {leads.map((lead) => (
        <li key={lead.id}>
          <LeadCardRow
            lead={lead}
            stage={stages.find((s) => s.key === lead.stage_key)}
            now={time}
          />
        </li>
      ))}
    </ul>
  );
}
