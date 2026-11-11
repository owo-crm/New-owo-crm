/**
 * Раздел денег по заказу агентства — TypeScript-копия SQL-функции public.agency_order_split
 * (db/migrations/20261111000020_agency.sql). Нужна для живого расчёта в форме, до сохранения.
 * Обе версии сверяются тестом tests/db/agency.test.ts: менять только вместе.
 *
 * Правила (docs/02-data-model.md, «Agencja»):
 *   база = сумма − прямые расходы        (рекламный бюджет не участвует никогда)
 *   продажа  → кто продал               (role = "sale")
 *   компания → user_id = null           (role = "company")
 *   работа   → исполнителям по часам    (role = "work")
 * Всё целыми грошами вниз; остаток от округления — компании. Сумма строк = база до гроша.
 * Нет продавца или нет часов → строка с userId = null («nierozdzielone»), не прячем.
 * Работает и в браузере: без server-only.
 */

/** Доли в базисных пунктах: 1 % = 100, сумма = 10 000. */
export type Shares = { saleBp: number; companyBp: number; workBp: number };

/**
 * Значения по умолчанию (10 / 25 / 65). Партнёрами ещё не утверждены — поэтому настоящие доли
 * берутся из колонок организации agency_share_*_bp; здесь только запасной вариант и значения
 * по умолчанию тех колонок (менять вместе с миграцией).
 */
export const DEFAULT_SHARES: Shares = { saleBp: 1000, companyBp: 2500, workBp: 6500 };

export type SplitRole = "sale" | "work" | "company";
export type SplitLine = { userId: string | null; role: SplitRole; amountGrosze: number };
export type WorkLine = { userId: string; hours: number };

export type SplitInput = {
  amountGrosze: number;
  directCostsGrosze: number;
  /** Только для отчёта: в расчёт не входит. Поле есть, чтобы это было видно в типе. */
  adBudgetGrosze?: number;
  soldBy: string | null;
  work: WorkLine[];
};

export function validShares(s: Shares) {
  return (
    [s.saleBp, s.companyBp, s.workBp].every((x) => Number.isInteger(x) && x >= 0) &&
    s.saleBp + s.companyBp + s.workBp === 10000
  );
}

/** База раздела: сумма минус прямые расходы (не меньше нуля). */
export function splitBase(input: Pick<SplitInput, "amountGrosze" | "directCostsGrosze">) {
  return Math.max(0, Math.trunc(input.amountGrosze) - Math.trunc(input.directCostsGrosze));
}

/** Часы → сотые доли часа целым числом (как numeric(6,2) * 100 в SQL). */
function hundredths(hours: number) {
  return Math.round(hours * 100);
}

export function splitOrder(input: SplitInput, shares: Shares = DEFAULT_SHARES): SplitLine[] {
  if (!validShares(shares)) throw new Error("invalid_shares");
  const base = splitBase(input);
  const sale = Math.floor((base * shares.saleBp) / 10000);
  const work = Math.floor((base * shares.workBp) / 10000);
  const lines: SplitLine[] = [{ userId: input.soldBy, role: "sale", amountGrosze: sale }];

  const workers = input.work.filter((w) => hundredths(w.hours) > 0);
  const total = workers.reduce((sum, w) => sum + hundredths(w.hours), 0);
  let given = 0;
  if (total === 0) {
    lines.push({ userId: null, role: "work", amountGrosze: work });
    given = work;
  } else {
    for (const w of workers) {
      const amount = Math.floor((work * hundredths(w.hours)) / total);
      given += amount;
      lines.push({ userId: w.userId, role: "work", amountGrosze: amount });
    }
  }
  lines.push({ userId: null, role: "company", amountGrosze: base - sale - given });
  return lines;
}

/** Строки раздела, сложенные по человеку: «за продажу», «за работу», «итого». */
export type PersonShare = {
  userId: string;
  saleGrosze: number;
  workGrosze: number;
  totalGrosze: number;
};

export type SplitTotals = {
  people: PersonShare[];
  companyGrosze: number;
  /** Работа без часов + продажа без продавца: деньги, которые ещё некому отдать. */
  unassignedGrosze: number;
  totalGrosze: number;
};

export function totalsBySplit(lines: SplitLine[]): SplitTotals {
  const people = new Map<string, PersonShare>();
  let companyGrosze = 0;
  let unassignedGrosze = 0;
  for (const line of lines) {
    if (line.role === "company") {
      companyGrosze += line.amountGrosze;
    } else if (!line.userId) {
      unassignedGrosze += line.amountGrosze;
    } else {
      const p = people.get(line.userId) ?? {
        userId: line.userId,
        saleGrosze: 0,
        workGrosze: 0,
        totalGrosze: 0,
      };
      if (line.role === "sale") p.saleGrosze += line.amountGrosze;
      else p.workGrosze += line.amountGrosze;
      p.totalGrosze += line.amountGrosze;
      people.set(line.userId, p);
    }
  }
  const list = [...people.values()].sort((a, b) => b.totalGrosze - a.totalGrosze);
  return {
    people: list,
    companyGrosze,
    unassignedGrosze,
    totalGrosze: companyGrosze + unassignedGrosze + list.reduce((s, p) => s + p.totalGrosze, 0),
  };
}

/** «10 %» из базисных пунктов. */
export function sharePercent(bp: number) {
  return `${new Intl.NumberFormat("pl-PL", { maximumFractionDigits: 2 }).format(bp / 100)} %`;
}
