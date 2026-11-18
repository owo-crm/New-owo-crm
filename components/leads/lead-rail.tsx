"use client";
import Link from "next/link";
import { useState } from "react";
import { Plus, Search } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import type { Lead, PipelineStage } from "@/lib/leads/types";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { LeadRailItem } from "./lead-row";

/**
 * Колонка лидов слева от открытого лида (компьютер, решение 048): поиск и чипы работают
 * мгновенно, без перезагрузки, по последним лидам; переход между лидами — один щелчок.
 */
export function LeadRail({
  leads,
  stages,
  currentId,
  now,
}: {
  leads: Lead[];
  stages: PipelineStage[];
  currentId: string;
  now: string;
}) {
  const [query, setQuery] = useState("");
  const [onlyNew, setOnlyNew] = useState(false);
  const time = Date.parse(now);
  const newCount = leads.filter((l) => l.stage_key === "new").length;
  const q = query.trim().toLowerCase();
  const shown = leads.filter(
    (l) =>
      (!onlyNew || l.stage_key === "new") &&
      (!q ||
        [l.client_name, l.phone_e164, l.email, l.event_type, l.event_city]
          .filter(Boolean)
          .some((v) => v!.toLowerCase().includes(q))),
  );
  const chip = (on: boolean) =>
    cn(
      "h-8 rounded-full px-3 text-[12.5px] font-semibold transition-colors",
      on ? "bg-accent/12 text-accent" : "border-line text-ink-soft hover:text-ink border",
    );
  return (
    <aside className="border-line bg-surface hidden h-[calc(100dvh-6rem)] flex-col overflow-hidden rounded-2xl border shadow-[var(--shadow)] lg:sticky lg:top-[4.5rem] lg:flex">
      <div className="grid gap-2.5 p-3 pb-2">
        <label className="relative">
          <Search className="text-ink-faint pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("leads.railSearch")}
            aria-label={t("leads.search")}
            className="border-line-strong bg-surface h-10 w-full rounded-xl border pr-3 pl-9 text-[13.5px]"
          />
        </label>
        <div className="flex gap-1.5">
          <button type="button" className={chip(!onlyNew)} onClick={() => setOnlyNew(false)}>
            {t("leads.quickAll")}
          </button>
          <button type="button" className={chip(onlyNew)} onClick={() => setOnlyNew(true)}>
            {t("leads.railNew", { count: newCount })}
          </button>
        </div>
      </div>
      <nav aria-label={t("nav.leads")} className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {shown.map((lead) => (
          <LeadRailItem
            key={lead.id}
            lead={lead}
            stage={stages.find((s) => s.key === lead.stage_key)}
            active={lead.id === currentId}
            now={time}
          />
        ))}
        {!shown.length ? (
          <p className="text-ink-faint px-3 py-6 text-center text-[13px]">{t("leads.noResults")}</p>
        ) : null}
      </nav>
      <div className="border-line border-t p-3">
        <Link href="/leady/nowy" className={cn(buttonVariants(), "w-full")}>
          <Plus />
          {t("nav.newLead")}
        </Link>
      </div>
    </aside>
  );
}
