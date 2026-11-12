import { cn } from "@/lib/utils";

/** Цвета аватарок: мягкие, разные для разных людей (по хэшу имени), читаемы в обеих темах. */
const TONES = [
  "#5b7cfa",
  "#e0688a",
  "#2f9e8f",
  "#d58a2c",
  "#8b6cf0",
  "#3f9fd8",
  "#c76bd1",
  "#5aa55a",
];

function tone(seed: string) {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TONES[h % TONES.length];
}

export function initials(name: string) {
  const parts = name
    .replace(/[@._-]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "")).toUpperCase();
}

/** Круглая аватарка с инициалами. */
export function Avatar({
  name,
  size = 28,
  className,
}: {
  name: string;
  size?: number;
  className?: string;
}) {
  const c = tone(name);
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-semibold",
        className,
      )}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.38),
        color: c,
        background: `color-mix(in srgb, ${c} 16%, transparent)`,
      }}
    >
      {initials(name)}
    </span>
  );
}
