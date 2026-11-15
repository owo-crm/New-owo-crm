import Link from "next/link";
import { Mail, MessageCircle, Phone } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
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

const money = (grosze: number) =>
  new Intl.NumberFormat("pl-PL", {
    style: "currency",
    currency: "PLN",
    maximumFractionDigits: 0,
  }).format(grosze / 100);

/**
 * Список лидов — карточки (просьба Вани): на каждой сразу всё главное — кто, что за
 * мероприятие, когда и где, сколько гостей, бюджет, этап, кто ведёт, сколько ждёт ответа,
 * начало сообщения и быстрые «Zadzwoń»/WhatsApp. Вся карточка — ссылка на лид.
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
    <ul className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3" data-testid="lead-cards">
      {leads.map((lead) => {
        const stage = stages.find((s) => s.key === lead.stage_key);
        const waiting = waitingMinutes(lead, time);
        const owner = team.find((m) => m.id === lead.assigned_to)?.name;
        const facts = [
          lead.event_type,
          lead.event_city,
          lead.guests ? t("leads.guestsShort", { count: lead.guests }) : null,
          lead.package_name,
          lead.budget_grosze !== null ? money(lead.budget_grosze) : null,
        ].filter(Boolean);
        return (
          <li
            key={lead.id}
            className="border-line bg-surface hover:border-line-strong relative flex flex-col gap-2.5 rounded-2xl border p-3 shadow-[var(--shadow)] transition-colors sm:p-4"
          >
            <div className="flex items-start gap-3">
              <Avatar name={lead.client_name} size={34} />
              <div className="min-w-0 flex-1">
                <Link
                  href={`/leady/${lead.id}`}
                  className="block truncate font-semibold after:absolute after:inset-0 after:rounded-2xl"
                >
                  {lead.client_name}
                </Link>
                <p className="text-ink-faint truncate text-[12.5px]">
                  #{lead.number} · {lead.source_label}
                </p>
              </div>
              <StageBadge stage={stage} label={stage?.label_pl ?? lead.stage_key} />
            </div>
            <div className="bg-surface-2/70 rounded-xl px-3 py-2 text-[13px]">
              <p className={cn("font-semibold", !lead.event_date && "text-ink-faint")}>
                {eventDateLabel(lead.event_date)}
              </p>
              <p className="text-ink-soft truncate">
                {facts.length ? facts.join(" · ") : t("leads.noDetails")}
              </p>
            </div>
            {lead.message ? (
              <p className="text-ink-soft line-clamp-1 text-[13px] break-words sm:line-clamp-2">
                {lead.message}
              </p>
            ) : null}
            <div className="mt-auto flex items-center gap-2 text-[13px]">
              <span
                className={cn(
                  "flex min-w-0 flex-1 items-center gap-1.5",
                  owner ? "text-ink-soft" : "text-ink-faint",
                )}
              >
                {owner ? <Avatar name={owner} size={20} /> : null}
                <span className="truncate">{owner ?? t("leads.unassigned")}</span>
                {waiting !== null && stage?.kind === "open" ? (
                  <span className="text-urgent ml-1 shrink-0 font-semibold tabular-nums">
                    {formatWaiting(waiting)}
                  </span>
                ) : null}
              </span>
              {/* Кнопки поверх ссылки карточки (relative z-10). */}
              {lead.phone_e164 ? (
                <span className="relative z-10 flex shrink-0 gap-1.5">
                  <a
                    href={`tel:${lead.phone_e164}`}
                    aria-label={t("leads.call")}
                    className={buttonVariants({ variant: "soft", size: "icon" })}
                  >
                    <Phone />
                  </a>
                  <a
                    href={`https://wa.me/${lead.phone_e164.slice(1)}`}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={t("leads.whatsapp")}
                    className={buttonVariants({ variant: "success", size: "icon" })}
                  >
                    <MessageCircle />
                  </a>
                </span>
              ) : lead.email ? (
                <a
                  href={`mailto:${lead.email}`}
                  aria-label={t("leads.email")}
                  className={cn(
                    buttonVariants({ variant: "secondary", size: "icon" }),
                    "relative z-10",
                  )}
                >
                  <Mail />
                </a>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
