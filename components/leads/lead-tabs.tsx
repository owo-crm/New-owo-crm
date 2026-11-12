"use client";
import { useState } from "react";
import { t, type MessageKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * Вкладки внутри карточки лида (решение 035).
 *
 * Раньше всё лежало одной стопкой карточек и сливалось в стену. Теперь данные,
 * документы, деньги и история разведены по вкладкам: на экране одновременно только то,
 * с чем сейчас работают. Счётчик на вкладке показывает, есть ли там что-то, не открывая её.
 */

export type LeadTab = { key: string; label: MessageKey; count?: number; content: React.ReactNode };

export function LeadTabs({ tabs, initial }: { tabs: LeadTab[]; initial?: string }) {
  const usable = tabs.filter((tab) => tab.content);
  const [current, setCurrent] = useState(
    usable.some((tab) => tab.key === initial) ? initial : usable[0]?.key,
  );
  const shown = usable.find((tab) => tab.key === current) ?? usable[0];

  return (
    <div className="grid gap-5">
      <div className="border-line flex gap-1 overflow-x-auto border-b" role="tablist">
        {usable.map((tab) => {
          const active = tab.key === shown?.key;
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setCurrent(tab.key)}
              className={cn(
                "-mb-px flex shrink-0 items-center gap-2 border-b-2 px-3 pt-1 pb-2.5 text-[13.5px] font-medium transition-colors",
                active
                  ? "border-accent text-accent"
                  : "text-ink-soft hover:text-ink border-transparent",
              )}
            >
              {t(tab.label)}
              {tab.count ? (
                <span
                  className={cn(
                    "rounded-full px-1.5 text-[11px] leading-5 font-semibold",
                    active ? "bg-accent/12 text-accent" : "bg-surface-2 text-ink-faint",
                  )}
                >
                  {tab.count}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      <div role="tabpanel">{shown?.content}</div>
    </div>
  );
}
