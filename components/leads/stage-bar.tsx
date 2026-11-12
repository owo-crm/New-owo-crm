"use client";
import { Check, X } from "lucide-react";
import type { PipelineStage } from "@/lib/leads/types";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * Этапы лида — дорожка, а не выпадающий список (решение 035).
 *
 * Список прятал главное: где лид сейчас и что дальше. Дорожка показывает путь целиком,
 * пройденное закрашено, следующий шаг — первый незакрашенный, и до любого этапа один щелчок.
 * Проигрышные этапы вынесены вправо: их выбирают редко и не по ошибке.
 */
export function StageBar({
  stages,
  current,
  disabled,
  onChange,
}: {
  stages: PipelineStage[];
  current: string;
  disabled?: boolean;
  onChange: (key: string) => void;
}) {
  const path = stages.filter((s) => s.kind !== "lost");
  const lost = stages.filter((s) => s.kind === "lost");
  const index = path.findIndex((s) => s.key === current);
  const isLost = lost.some((s) => s.key === current);

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <ol className="flex min-w-0 flex-wrap items-center gap-1">
        {path.map((stage, i) => {
          const done = !isLost && i < index;
          const active = stage.key === current;
          const won = stage.kind === "won";
          return (
            <li key={stage.key}>
              <button
                type="button"
                disabled={disabled}
                aria-current={active ? "step" : undefined}
                onClick={() => onChange(stage.key)}
                className={cn(
                  "flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium transition-colors",
                  "disabled:pointer-events-none disabled:opacity-60",
                  active && won && "bg-ok text-white",
                  active && !won && "bg-accent text-accent-ink",
                  !active && done && "bg-accent/12 text-accent hover:bg-accent/20",
                  !active && !done && "text-ink-soft hover:bg-surface-2 hover:text-ink",
                )}
              >
                {done ? <Check className="size-3.5" aria-hidden /> : null}
                {stage.label_pl}
              </button>
            </li>
          );
        })}
      </ol>

      {lost.length ? (
        <div className="border-line flex items-center gap-1 border-l pl-3">
          {lost.map((stage) => (
            <button
              key={stage.key}
              type="button"
              disabled={disabled}
              onClick={() => onChange(stage.key)}
              aria-current={stage.key === current ? "step" : undefined}
              className={cn(
                "flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium transition-colors",
                "disabled:pointer-events-none disabled:opacity-60",
                stage.key === current
                  ? "bg-urgent text-white"
                  : "text-ink-faint hover:bg-urgent/10 hover:text-urgent",
              )}
            >
              {stage.key === current ? <X className="size-3.5" aria-hidden /> : null}
              {stage.label_pl}
            </button>
          ))}
        </div>
      ) : null}

      <span className="sr-only" aria-live="polite">
        {t("leads.stage")}: {stages.find((s) => s.key === current)?.label_pl}
      </span>
    </div>
  );
}
