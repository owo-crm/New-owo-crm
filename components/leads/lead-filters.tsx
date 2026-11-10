"use client";
import Link from "next/link";
import { useState } from "react";
import { Field, Select } from "@/components/ui/field";
import { Button, buttonVariants } from "@/components/ui/button";
import type { LeadFilters } from "@/lib/leads/filters";
import type { LeadChannel, PipelineStage } from "@/lib/leads/types";
import { t } from "@/lib/i18n";
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
  const [expanded, setExpanded] = useState(false);
  return (
    <form className="border-line bg-surface mb-6 grid gap-3 rounded-[22px] border p-4 sm:grid-cols-2 xl:grid-cols-4">
      <input type="hidden" name="view" value={filters.view} />
      <Field
        name="q"
        label={t("leads.search")}
        defaultValue={filters.q}
        placeholder={t("leads.searchHint")}
      />
      <Button
        type="button"
        variant="secondary"
        className="sm:hidden"
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
      >
        {t("leads.moreFilters")}
      </Button>
      <div className={expanded ? "contents" : "hidden sm:contents"}>
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
        <Field name="from" type="date" label={t("leads.dateFrom")} defaultValue={filters.from} />
        <Field name="to" type="date" label={t("leads.dateTo")} defaultValue={filters.to} />
      </div>
      <div className="flex items-end gap-3 sm:col-span-2">
        <Button type="submit">{t("leads.filter")}</Button>
        <Link
          href={filters.view === "board" ? "/leady?view=board" : "/leady"}
          className={buttonVariants({ variant: "ghost" })}
        >
          {t("leads.clear")}
        </Link>
      </div>
    </form>
  );
}
