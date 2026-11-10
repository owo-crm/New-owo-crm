import { t } from "@/lib/i18n";
/**
 * «Sezon» — субботы года как товар фирмы. Чистые функции без базы: легко тестировать.
 * Данные о бронях и запросах придут из таблиц bookings и leads (этапы 1 и 3).
 */

export type SaturdayStatus = "free" | "booked" | "hold" | "inquiry";

export type SeasonMonth = {
  month: number; // 0–11
  label: string; // «sty», «lut»…
  saturdays: { iso: string; day: number; status: SaturdayStatus }[];
};

const MONTHS_PL = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
].map((month) => t(`season.months.${month}` as import("@/lib/i18n").MessageKey));

/** Дата → «2027-06-14» без сдвигов часового пояса. */
export function toIsoDate(year: number, month: number, day: number) {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Какой сезон показывать: с сентября фирмы уже продают следующий год,
 * поэтому с 1 сентября показываем следующий.
 */
export function seasonYear(today: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Warsaw",
    year: "numeric",
    month: "numeric",
  }).formatToParts(today);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  return month >= 9 ? year + 1 : year;
}

/** Все субботы года по месяцам; статус берётся из карты «дата → статус». */
export function buildSeason(
  year: number,
  statuses: Record<string, SaturdayStatus> = {},
): SeasonMonth[] {
  return MONTHS_PL.map((label, month) => {
    const saturdays: SeasonMonth["saturdays"] = [];
    const first = new Date(Date.UTC(year, month, 1)).getUTCDay(); // 0 = niedziela
    for (let day = 1 + ((6 - first + 7) % 7); day <= 31; day += 7) {
      if (new Date(Date.UTC(year, month, day)).getUTCMonth() !== month) break;
      const iso = toIsoDate(year, month, day);
      saturdays.push({ iso, day, status: statuses[iso] ?? "free" });
    }
    return { month, label, saturdays };
  });
}

export function countSaturdays(season: SeasonMonth[], status: SaturdayStatus) {
  return season.reduce((n, m) => n + m.saturdays.filter((s) => s.status === status).length, 0);
}

/** Сколько лид ждёт ответа: «2 min», «47 min», «3 godz.», «2 dni». */
export function formatWaiting(minutes: number) {
  const m = Math.max(0, Math.floor(minutes));
  if (m < 60) return t("season.minutes", { count: m });
  const h = Math.floor(m / 60);
  if (h < 24) return t("season.hours", { count: h });
  const d = Math.floor(h / 24);
  return t(d === 1 ? "season.day" : "season.days", { count: d });
}

/** Порог «горячего» лида: дольше 10 минут без ответа — красный таймер. */
export const HOT_AFTER_MINUTES = 10;
