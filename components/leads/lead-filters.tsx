"use client";
import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Search, SlidersHorizontal } from "lucide-react";
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
  counts = {},
}: {
  filters: LeadFilters;
  /** Лидов на этапе — числа на чипах (решение 048). */
  counts?: Record<string, number>;
  options: {
    stages: PipelineStage[];
    channels: LeadChannel[];
    team: { id: string; name: string }[];
  };
}) {
  // Etapy «przegrane» (Spam, Odrzucony) są ukryte w liście — mają własne chipy.
  const lost = options.stages.filter((s) => s.kind === "lost");
  const lostSelected = lost.some((s) => s.key === filters.stage);
  const active = DETAILED.filter(
    (key) => filters[key] && !(key === "stage" && lostSelected),
  ).length;
  const [open, setOpen] = useState(active > 0);

  // Поиск по мере ввода: кнопку жать не надо. Пауза 250 мс, чтобы не дёргать сервер
  // на каждую букву, и первая отрисовка не перезапрашивает то, что уже показано.
  const router = useRouter();
  const [query, setQuery] = useState(filters.q ?? "");
  const [pending, start] = useTransition();
  const first = useRef(true);
  const box = useRef<HTMLInputElement>(null);
  // Живое обновление списка перерисовывает экран и уводит курсор из поля.
  // Возвращаем его, если человек печатал только что: через три секунды тишины
  // фокус уже не наш — забирать его обратно было бы грубо.
  const lastTyped = useRef(0);
  useEffect(() => {
    const el = box.current;
    if (!el || document.activeElement === el || Date.now() - lastTyped.current > 3000) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  });
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const timer = setTimeout(() => {
      start(() => router.replace(leadFilterUrl(filters, { q: query || undefined })));
    }, 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);
  const quick = [
    ["", "leads.quickAll"],
    ["waiting", "leads.quickWaiting"],
    ["mine", "leads.quickMine"],
    ["month", "leads.quickMonth"],
  ] as const;
  return (
    <div className="mb-4 grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-sm" role="search">
          <Search className="text-ink-faint pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <input
            ref={box}
            value={query}
            onChange={(e) => {
              lastTyped.current = Date.now();
              setQuery(e.target.value);
            }}
            placeholder={t("leads.searchHint")}
            aria-label={t("leads.search")}
            className="border-line-strong bg-surface h-10 w-full rounded-lg border pr-9 pl-9 text-sm"
          />
          {pending ? (
            <Loader2 className="text-ink-faint absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin" />
          ) : null}
        </div>
        <Button
          type="button"
          variant={active ? "primary" : "ghost"}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="gap-2"
        >
          <SlidersHorizontal className="size-4" />
          <span className="max-sm:sr-only">
            {active ? t("leads.filtersOn", { count: active }) : t("leads.filters")}
          </span>
        </Button>
      </div>

      {/* Чипы листаются вбок (как в мобильном макете): «Wszystkie», этапы с числами, быстрые фильтры. */}
      <nav
        aria-label={t("leads.filters")}
        className="-mx-4 flex [scrollbar-width:none] gap-1.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0"
      >
        {(() => {
          const chip = (on: boolean, dashed = false) =>
            cn(
              "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-[13px] font-semibold whitespace-nowrap transition-colors",
              on
                ? "border-ink bg-ink text-bg"
                : dashed
                  ? "border-line-strong text-ink-faint hover:text-ink border-dashed"
                  : "border-line bg-surface text-ink-soft hover:border-line-strong hover:text-ink",
            );
          const num = (n: number | undefined, on: boolean) =>
            n ? <span className={on ? "opacity-70" : "text-ink-faint"}>{n}</span> : null;
          const total = options.stages
            .filter((st) => st.kind !== "lost")
            .reduce((sum, st) => sum + (counts[st.key] ?? 0), 0);
          const allOn = !filters.quick && !filters.stage;
          return (
            <>
              <Link
                href={leadFilterUrl(filters, { quick: undefined, stage: undefined })}
                aria-current={allOn ? "true" : undefined}
                className={chip(allOn)}
              >
                {t("leads.quickAll")} {num(total, allOn)}
              </Link>
              {options.stages
                .filter((st) => st.kind !== "lost" && counts[st.key])
                .map((st) => {
                  const on = filters.stage === st.key;
                  return (
                    <Link
                      key={st.key}
                      href={leadFilterUrl(filters, {
                        quick: undefined,
                        stage: on ? undefined : st.key,
                      })}
                      aria-current={on ? "true" : undefined}
                      className={chip(on)}
                    >
                      {st.label_pl} {num(counts[st.key], on)}
                    </Link>
                  );
                })}
              {quick.slice(1).map(([value, label]) => {
                const on = filters.quick === value;
                return (
                  <Link
                    key={label}
                    href={leadFilterUrl(filters, {
                      quick: on ? undefined : (value as LeadFilters["quick"]),
                      stage: undefined,
                    })}
                    aria-current={on ? "true" : undefined}
                    className={chip(on)}
                  >
                    {t(label)}
                  </Link>
                );
              })}
              {lost.map((st) => {
                const on = filters.stage === st.key;
                return (
                  <Link
                    key={st.key}
                    href={leadFilterUrl(filters, {
                      quick: undefined,
                      stage: on ? undefined : st.key,
                    })}
                    aria-current={on ? "true" : undefined}
                    className={chip(on, true)}
                  >
                    {st.label_pl} {num(counts[st.key], on)}
                  </Link>
                );
              })}
            </>
          );
        })()}
      </nav>

      {open ? (
        <form className="border-line bg-surface grid gap-3 rounded-xl border p-4 sm:grid-cols-2 xl:grid-cols-3">
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
              className="border-line-strong bg-surface h-10 rounded-lg border px-3 text-sm"
            />
          </label>
          <label className="grid gap-2 text-sm font-semibold">
            {t("leads.dateTo")}
            <input
              type="date"
              name="to"
              defaultValue={filters.to}
              className="border-line-strong bg-surface h-10 rounded-lg border px-3 text-sm"
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
