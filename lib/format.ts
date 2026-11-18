import { t } from "@/lib/i18n";

/** Сколько лид ждёт ответа: «2 min», «47 min», «3 godz.», «2 dni». */
export function formatWaiting(minutes: number) {
  const m = Math.max(0, Math.floor(minutes));
  if (m < 60) return t("time.minutes", { count: m });
  const h = Math.floor(m / 60);
  if (h < 24) return t("time.hours", { count: h });
  const d = Math.floor(h / 24);
  return t(d === 1 ? "time.day" : "time.days", { count: d });
}

/** Дольше 10 минут без ответа — лид «горит». */
export const HOT_AFTER_MINUTES = 10;

export function plDate(iso: string | null) {
  return iso ? iso.split("-").reverse().join(".") : "";
}

export function plDateTime(value: string) {
  return new Intl.DateTimeFormat("pl-PL", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Europe/Warsaw",
  }).format(new Date(value));
}

/** Сегодняшняя дата в Варшаве как «2026-11-10». */
export function warsawToday(now: Date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Warsaw" }).format(now);
}

export function addMonths(iso: string, months: number) {
  const [y, m] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1 + months, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

/** Сетка месяца: недели с понедельника, включая «хвосты» соседних месяцев. */
export function monthGrid(monthIso: string) {
  const [year, month] = monthIso.split("-").map(Number);
  const first = new Date(Date.UTC(year, month - 1, 1));
  const start = new Date(first);
  start.setUTCDate(1 - ((first.getUTCDay() + 6) % 7));
  const weeks: { iso: string; day: number; inMonth: boolean }[][] = [];
  const cursor = new Date(start);
  for (let w = 0; w < 6; w++) {
    const week = [];
    for (let d = 0; d < 7; d++) {
      week.push({
        iso: cursor.toISOString().slice(0, 10),
        day: cursor.getUTCDate(),
        inMonth: cursor.getUTCMonth() === month - 1,
      });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    weeks.push(week);
    if (cursor.getUTCMonth() !== month - 1 && w >= 3) break;
  }
  return weeks;
}

/**
 * Польское множественное число: 1 umowa · 2–4 umowy · 5+ umów.
 * Числа 12–14 идут по последней форме, как и положено в языке.
 */
export function plForm<T extends string>(n: number, one: T, few: T, many: T): T {
  const d = Math.abs(n) % 10;
  const h = Math.abs(n) % 100;
  if (Math.abs(n) === 1) return one;
  if (d >= 2 && d <= 4 && (h < 12 || h > 14)) return few;
  return many;
}

/** «teraz», «5 min temu», «2 godz. temu», «wczoraj», «3 dni temu», дальше — дата. */
export function timeAgo(iso: string, now: number = Date.now()) {
  const m = Math.max(0, Math.floor((now - Date.parse(iso)) / 60000));
  if (m < 1) return t("time.now");
  if (m < 60) return t("time.minutesAgo", { count: m });
  const h = Math.floor(m / 60);
  if (h < 24) return t("time.hoursAgo", { count: h });
  const d = Math.floor(h / 24);
  if (d === 1) return t("time.yesterday");
  if (d < 7) return t("time.daysAgo", { count: d });
  return plDateTime(iso).split(",")[0];
}

/** Время в списке: сегодня — «22:26», иначе — «15.12». */
export function listTime(iso: string, now: number = Date.now()) {
  const fmt = (o: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat("pl-PL", { timeZone: "Europe/Warsaw", ...o }).format(new Date(iso));
  const day = (v: number) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Warsaw" }).format(new Date(v));
  return day(Date.parse(iso)) === day(now)
    ? fmt({ hour: "2-digit", minute: "2-digit" })
    : fmt({ day: "2-digit", month: "2-digit" });
}
