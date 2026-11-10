import { hasKnownResponse } from "@/lib/leads/response";
import Link from "next/link";
import { t } from "@/lib/i18n";
import type { Lead, PipelineStage } from "@/lib/leads/types";
export function eventDateLabel(date: string | null) {
  return date ? date.split("-").reverse().join(".") : t("leads.noDate");
}
export function LeadList({ leads, stages }: { leads: Lead[]; stages: PipelineStage[] }) {
  return (
    <ul className="border-line bg-surface overflow-hidden rounded-[22px] border">
      {leads.map((lead) => (
        <li key={lead.id} className="border-line border-b last:border-0">
          <Link
            href={`/leady/${lead.id}`}
            className="hover:bg-surface-2 grid gap-3 px-5 py-5 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)] sm:items-center sm:px-6"
          >
            <div className="min-w-0">
              <p className="text-ink-soft text-xs">
                #{lead.number} · {lead.source_label}
              </p>
              <h2 className="mt-1 text-lg font-bold break-words">{lead.client_name}</h2>
              <p className="text-ink-soft mt-1 text-sm break-words">
                {lead.phone_e164 || lead.email}
              </p>
            </div>
            <div className="text-sm">
              <p className="font-bold">{eventDateLabel(lead.event_date)}</p>
              <p className="text-ink-soft mt-1">
                {[lead.event_type, lead.event_city].filter(Boolean).join(" · ") ||
                  t("leads.noDetails")}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:justify-end">
              <span className="bg-surface-2 rounded-lg px-3 py-2 text-sm font-bold">
                {stages.find((s) => s.key === lead.stage_key)?.label_pl ?? lead.stage_key}
              </span>
              {!hasKnownResponse(lead) &&
              stages.find((s) => s.key === lead.stage_key)?.kind === "open" ? (
                <span className="text-hold text-sm">{t("leads.waiting")}</span>
              ) : null}
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
