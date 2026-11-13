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

/** Круглая аватарка: фото, если загружено, иначе инициалы на мягком цвете. */
export function Avatar({
  name,
  src,
  size = 28,
  className,
}: {
  name: string;
  src?: string | null;
  size?: number;
  className?: string;
}) {
  if (src)
    return (
      // eslint-disable-next-line @next/next/no-img-element -- маленькая картинка из своей базы
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        className={cn("shrink-0 rounded-full object-cover", className)}
        style={{ width: size, height: size }}
      />
    );
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

/**
 * Мини-иконка кабинета (решение 039): логотип, если загружен, иначе первая буква названия
 * на цвете, выбранном по id кабинета, — у разных кабинетов разные цвета, и цвет не меняется.
 */
export function OrgMark({
  id,
  name,
  src,
  size = 22,
  className,
}: {
  id: string;
  name: string;
  src?: string | null;
  size?: number;
  className?: string;
}) {
  const radius = Math.round(size * 0.27);
  if (src)
    return (
      // eslint-disable-next-line @next/next/no-img-element -- маленькая картинка из своей базы
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        className={cn("shrink-0 object-cover", className)}
        style={{ width: size, height: size, borderRadius: radius }}
      />
    );
  const c = tone(id);
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center font-bold text-white",
        className,
      )}
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        fontSize: Math.round(size * 0.5),
        background: c,
      }}
    >
      {(name.trim()[0] ?? "?").toUpperCase()}
    </span>
  );
}
