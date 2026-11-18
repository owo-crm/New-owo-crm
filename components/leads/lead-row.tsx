import Link from "next/link";
import { CalendarDays, ChevronRight, Clock } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { listTime, timeAgo } from "@/lib/format";
import { hasKnownResponse } from "@/lib/leads/response";
import type { Lead, PipelineStage } from "@/lib/leads/types";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * Строки списка лидов (решение 048, по макетам Вани).
 * Телефон и страница «Leady» — карточка с этапом, датой и «2 godz. temu» (без картинок).
 * Компьютер, рядом с открытым лидом, — компактная строка в колонке слева.
 */

/** Цвет этапа: открытые — по порядку, выиграно — зелёный, потеряно — серый. */
const STAGE_TONES = ["var(--accent)", "#8b6cf0", "var(--hold)", "#2f9e8f", "#d65f9e", "#5b7cfa"];
export function stageTone(stage?: { kind: string; position: number }) {
  if (!stage) return "var(--ink-soft)";
  if (stage.kind === "won") return "var(--ok)";
  if (stage.kind === "lost") return "var(--ink-faint)";
  return STAGE_TONES[stage.position % STAGE_TONES.length];
}

export function StagePill({
  stage,
  label,
  size = "md",
}: {
  stage?: { kind: string; position: number };
  label: string;
  size?: "sm" | "md";
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full font-semibold",
        size === "sm" ? "h-6 px-2 text-[11.5px]" : "h-7 px-2.5 text-[12.5px]",
      )}
      style={{
        color: stageTone(stage),
        background: `color-mix(in oklab, ${stageTone(stage)} 13%, transparent)`,
      }}
    >
      {label}
    </span>
  );
}

export function eventLine(lead: Lead) {
  const date = lead.event_date ? lead.event_date.split("-").reverse().join(".") : null;
  return [lead.event_type, date].filter(Boolean).join(" · ") || t("leads.noDetails");
}

const waiting = (lead: Lead, stage?: PipelineStage) =>
  !hasKnownResponse(lead) && stage?.kind === "open";

/** Карточка как на телефоне: плитка, имя, этап, событие · дата, «2 godz. temu», стрелка. */
export function LeadCardRow({
  lead,
  stage,
  now,
}: {
  lead: Lead;
  stage?: PipelineStage;
  now: number;
}) {
  const hot = waiting(lead, stage);
  return (
    <Link
      href={`/leady/${lead.id}`}
      className={cn(
        "border-line bg-surface hover:border-line-strong group relative flex items-center gap-3.5 overflow-hidden rounded-2xl border p-3 shadow-[var(--shadow)] transition-[border-color,transform] duration-150 active:scale-[0.99]",
        hot && "border-urgent/40",
      )}
    >
      {hot ? <span className="bg-urgent absolute inset-y-0 left-0 w-1" aria-hidden /> : null}
      <span className="min-w-0 flex-1">
        <span className="flex items-start gap-2">
          <span className="min-w-0 flex-1 truncate text-[15.5px] font-semibold">
            {lead.client_name}
          </span>
          <StagePill stage={stage} label={stage?.label_pl ?? lead.stage_key} size="sm" />
        </span>
        <span className="text-ink-soft mt-1 flex items-center gap-1.5 text-[13px]">
          <CalendarDays className="text-ink-faint size-3.5 shrink-0" />
          <span className="truncate">{eventLine(lead)}</span>
        </span>
        <span
          className={cn(
            "mt-0.5 flex items-center gap-1.5 text-[12.5px]",
            hot ? "text-urgent font-semibold" : "text-ink-faint",
          )}
        >
          <Clock className="size-3.5 shrink-0" />
          {timeAgo(lead.created_at, now)}
          {lead.event_city ? (
            <span className="text-ink-faint truncate">· {lead.event_city}</span>
          ) : null}
        </span>
      </span>
      <ChevronRight className="text-ink-faint size-5 shrink-0 transition-transform duration-150 group-hover:translate-x-0.5" />
    </Link>
  );
}

/** Компактная строка в колонке слева от открытого лида (компьютер). */
export function LeadRailItem({
  lead,
  stage,
  active,
  now,
}: {
  lead: Lead;
  stage?: PipelineStage;
  active: boolean;
  now: number;
}) {
  return (
    <Link
      href={`/leady/${lead.id}`}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex gap-3 rounded-xl px-3 py-2.5 transition-colors duration-150",
        active ? "bg-accent/8" : "hover:bg-surface-2",
      )}
    >
      {active ? (
        <span className="bg-accent absolute inset-y-1.5 left-0 w-[3px] rounded-full" aria-hidden />
      ) : null}
      <Avatar name={lead.client_name} size={40} />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">
            {lead.client_name}
          </span>
          <span className="text-ink-faint shrink-0 text-[11.5px] tabular-nums">
            {listTime(lead.created_at, now)}
          </span>
        </span>
        <span
          className="mt-0.5 flex items-center gap-1.5 text-[12.5px] font-medium"
          style={{ color: stageTone(stage) }}
        >
          <span className="size-1.5 rounded-full bg-current" aria-hidden />
          {stage?.label_pl ?? lead.stage_key}
        </span>
        <span className="text-ink-soft block truncate text-[12.5px]">{eventLine(lead)}</span>
      </span>
    </Link>
  );
}
