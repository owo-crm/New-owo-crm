"use client";
import Link from "next/link";
import { useState } from "react";
import { Search, SlidersHorizontal } from "lucide-react";
import { Select } from "@/components/ui/field";
import { Button, buttonVariants } from "@/components/ui/button";
import { leadFilterUrl, type LeadFilters } from "@/lib/leads/filters";
import type { LeadChannel, PipelineStage } from "@/lib/leads/types";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const DETAILED = ["stage", "source", "assigned", "from", "to"] as const;

/**
 * Поиск и быстрые фильтры всегда на виду; подробные — за кнопкой «Filtry»,
 * чтобы список начинался сразу под шапкой.
 */
export function LeadFiltersForm({
  filters,
  options,
}: {
  filters: LeadFilters;
  options: {
    stages: PipelineStage[];
    channels: LeadChannel[];
    team: { id: string; name: string }[];
  };
}) {
  const active = DETAILED.filter((key) => filters[key]).length;
  const [open, setOpen] = useState(active > 0);
  const quick = [
    ["", "leads.quickAll"],
    ["waiting", "leads.quickWaiting"],
    ["mine", "leads.quickMine"],
    ["month", "leads.quickMonth"],
  ] as const;
  return (
    <div className="mb-4 grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <form className="flex min-w-0 flex-1 gap-2 sm:max-w-sm" role="search">
          <input type="hidden" name="view" value={filters.view} />
          {filters.quick ? <input type="hidden" name="quick" value={filters.quick} /> : null}
          <div className="relative min-w-0 flex-1">
            <Search className="text-ink-faint pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
            <input
              name="q"
              defaultValue={filters.q}
              placeholder={t("leads.searchHint")}
              aria-label={t("leads.search")}
              className="border-line-strong bg-surface h-10 w-full rounded-[10px] border pr-3 pl-9 text-sm"
            />
          </div>
          <Button type="submit" variant="secondary" className="shrink-0">
            {t("leads.searchAction")}
          </Button>
        </form>
        <Button
          type="button"
          variant={active ? "primary" : "ghost"}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="gap-2"
        >
          <SlidersHorizontal className="size-4" />
          {active ? t("leads.filtersOn", { count: active }) : t("leads.filters")}
        </Button>
      </div>

      <nav aria-label={t("leads.filters")} className="flex flex-wrap gap-1.5">
        {quick.map(([value, label]) => {
          const on = (filters.quick ?? "") === value;
          return (
            <Link
              key={label}
              href={leadFilterUrl(filters, { quick: (value || undefined) as LeadFilters["quick"] })}
              aria-current={on ? "true" : undefined}
              className={cn(
                "h-8 rounded-full border px-3 text-[13px] leading-[30px] font-bold transition-colors",
                on
                  ? "border-ink bg-ink text-bg"
                  : "border-line text-ink-soft hover:border-line-strong hover:text-ink",
              )}
            >
              {t(label)}
            </Link>
          );
        })}
      </nav>

      {open ? (
        <form className="border-line bg-surface grid gap-3 rounded-2xl border p-4 sm:grid-cols-2 xl:grid-cols-3">
          <input type="hidden" name="view" value={filters.view} />
          <input type="hidden" name="q" value={filters.q} />
          <Select name="stage" label={t("leads.stage")} defaultValue={filters.stage ?? ""}>
            <option value="">{t("leads.allStages")}</option>
            {options.stages.map((stage) => (
              <option key={stage.key} value={stage.key}>
                {stage.label_pl}
              </option>
            ))}
          </Select>
          <Select name="source" label={t("leads.source")} defaultValue={filters.source ?? ""}>
            <option value="">{t("leads.allSources")}</option>
            {options.channels.map((channel) => (
              <option key={channel.id} value={channel.id}>
                {channel.name}
              </option>
            ))}
          </Select>
          <Select name="assigned" label={t("leads.assigned")} defaultValue={filters.assigned ?? ""}>
            <option value="">{t("leads.everyone")}</option>
            <option value="unassigned">{t("leads.unassigned")}</option>
            {options.team.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </Select>
          <label className="grid gap-2 text-sm font-semibold">
            {t("leads.dateFrom")}
            <input
              type="date"
              name="from"
              defaultValue={filters.from}
              className="border-line-strong bg-surface h-10 rounded-[10px] border px-3 text-sm"
            />
          </label>
          <label className="grid gap-2 text-sm font-semibold">
            {t("leads.dateTo")}
            <input
              type="date"
              name="to"
              defaultValue={filters.to}
              className="border-line-strong bg-surface h-10 rounded-[10px] border px-3 text-sm"
            />
          </label>
          <div className="flex items-end gap-2">
            <Button type="submit">{t("leads.filter")}</Button>
            <Link
              href={leadFilterUrl(filters, {
                stage: undefined,
                source: undefined,
                assigned: undefined,
                from: undefined,
                to: undefined,
              })}
              className={buttonVariants({ variant: "ghost" })}
            >
              {t("leads.clear")}
            </Link>
          </div>
        </form>
      ) : null}
    </div>
  );
}
