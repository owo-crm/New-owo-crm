"use client";
import { useId, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Столбиковые графики для «Pulpit».
 *
 * Правила, по которым они сделаны: тонкие столбики со скруглением только сверху,
 * зазор в 2 px между сегментами одного столбика, подписи значений прямо на графике
 * (а не на каждой точке), бледная линия верха шкалы вместо сетки, подсказка при
 * наведении и легенда, когда рядов больше одного.
 *
 * Цвета — токены темы, поэтому тёмная тема получается сама. Для «часть от целого»
 * берём один цвет в двух светлотах, а не два разных: так пара различима и при
 * дальтонизме, где два соседних оттенка легко сливаются.
 */

export type Series = { key: string; label: string; color: string };
export type Row = { label: string; values: Record<string, number> };

function niceTop(max: number) {
  if (max <= 4) return Math.max(1, max);
  const step = Math.pow(10, Math.floor(Math.log10(max)));
  return Math.ceil(max / (step / 2)) * (step / 2);
}

/** Столбики по категориям: один ряд или несколько, сложенных друг на друга. */
export function StackedBars({
  rows,
  series,
  empty,
  className,
}: {
  rows: Row[];
  series: Series[];
  empty: string;
  className?: string;
}) {
  const id = useId();
  const [hover, setHover] = useState<number | null>(null);
  const sums = rows.map((r) => series.reduce((s, x) => s + (r.values[x.key] ?? 0), 0));
  const top = niceTop(Math.max(...sums, 1));

  if (!rows.length || sums.every((s) => s === 0))
    return <p className="text-ink-soft py-6 text-center text-[13.5px]">{empty}</p>;

  return (
    <div className={cn("grid gap-2", className)}>
      {series.length > 1 ? (
        <ul className="text-ink-soft flex flex-wrap gap-x-4 gap-y-1 text-[12.5px]">
          {series.map((s) => (
            <li key={s.key} className="flex items-center gap-1.5">
              <span
                className="size-2.5 rounded-[3px]"
                style={{ background: s.color }}
                aria-hidden
              />
              {s.label}
            </li>
          ))}
        </ul>
      ) : null}

      {/* Поле графика фиксированной высоты: только от неё проценты столбиков имеют смысл.
          Сверху оставлено место под подписи значений, снизу — линия основания. */}
      <div className="border-line relative flex h-40 items-end gap-1.5 border-b pt-6 sm:gap-2.5">
        <span className="border-line absolute inset-x-0 top-6 border-t border-dashed" aria-hidden />
        {rows.map((row, i) => {
          const sum = sums[i];
          return (
            <div
              key={row.label}
              className="relative flex h-full min-w-0 flex-1 flex-col justify-end"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              tabIndex={0}
              aria-describedby={`${id}-${i}`}
            >
              <div
                className="relative w-full"
                style={{ height: `${Math.max(sum ? 2 : 0, (sum / top) * 100)}%` }}
              >
                <span
                  className={cn(
                    "absolute inset-x-0 -top-5 text-center text-[12px] font-semibold tabular-nums",
                    sum ? "text-ink" : "text-ink-faint",
                  )}
                >
                  {sum || "—"}
                </span>
                <div className="flex h-full flex-col justify-end gap-[2px]">
                  {series.map((s, si) => {
                    const v = row.values[s.key] ?? 0;
                    if (!v) return null;
                    return (
                      <span
                        key={s.key}
                        className={cn("block w-full", si === 0 && "rounded-t-[4px]")}
                        style={{ background: s.color, flexGrow: v, flexBasis: 0, minHeight: 3 }}
                      />
                    );
                  })}
                </div>
              </div>
              {hover === i ? (
                <span
                  id={`${id}-${i}`}
                  role="tooltip"
                  className="border-line bg-surface text-ink pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 grid w-max -translate-x-1/2 gap-0.5 rounded-lg border px-2.5 py-1.5 text-[12px] shadow-[var(--shadow)]"
                >
                  <span className="font-semibold">{row.label}</span>
                  {series.map((s) => (
                    <span key={s.key} className="flex items-center gap-1.5">
                      <span
                        className="size-2 rounded-[2px]"
                        style={{ background: s.color }}
                        aria-hidden
                      />
                      {s.label}: <b className="tabular-nums">{row.values[s.key] ?? 0}</b>
                    </span>
                  ))}
                </span>
              ) : null}
            </div>
          );
        })}
      </div>

      {/* Подписи оси — отдельной строкой, чтобы не съедать высоту столбиков. */}
      <div className="flex gap-1.5 sm:gap-2.5">
        {rows.map((row) => (
          <span
            key={row.label}
            className="text-ink-faint min-w-0 flex-1 truncate text-center text-[11.5px]"
          >
            {row.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Горизонтальный рейтинг: один ряд, значение подписано у каждой полосы. */
export function RankedBars({
  rows,
  color,
  empty,
}: {
  rows: { label: string; value: number }[];
  color: string;
  empty: string;
}) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  if (!rows.length) return <p className="text-ink-soft py-6 text-center text-[13.5px]">{empty}</p>;
  return (
    <ul className="grid gap-2.5">
      {rows.map((r) => (
        <li key={r.label} className="grid grid-cols-[6.5rem_1fr_2.5rem] items-center gap-3">
          <span className="text-ink-soft truncate text-[13px]" title={r.label}>
            {r.label}
          </span>
          <span className="bg-surface-2 h-2.5 overflow-hidden rounded-[4px]">
            <span
              className="block h-full rounded-[4px]"
              style={{ width: `${Math.max(3, (r.value / max) * 100)}%`, background: color }}
            />
          </span>
          <span className="text-right text-[13px] font-semibold tabular-nums">{r.value}</span>
        </li>
      ))}
    </ul>
  );
}
