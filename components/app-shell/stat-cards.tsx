import { cn } from "@/lib/utils";

/** Показатели отдельными карточками с цветной иконкой (решение 032). */
export type StatCard = {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: string;
  urgent?: boolean;
};

export function StatCards({ items, className }: { items: StatCard[]; className?: string }) {
  return (
    <div className={cn("mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5", className)}>
      {items.map((s) => (
        <div
          key={s.label}
          className="border-line bg-surface flex items-center gap-3 rounded-2xl border px-4 py-3.5 shadow-[var(--shadow)]"
        >
          <span
            className="flex size-10 shrink-0 items-center justify-center rounded-xl"
            style={{ background: `color-mix(in srgb, ${s.tone} 14%, transparent)`, color: s.tone }}
          >
            <s.icon className="size-5" />
          </span>
          <span className="min-w-0">
            <span
              className={cn(
                "block text-[20px] leading-6 font-bold tabular-nums",
                s.urgent && "text-urgent",
              )}
            >
              {s.value}
            </span>
            <span className="text-ink-soft block truncate text-[12.5px]">{s.label}</span>
          </span>
        </div>
      ))}
    </div>
  );
}
