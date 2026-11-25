// Formuły kalkulatorów (wspólne dla przeglądarki i testów). Bez zależności.
// Wszystkie kwoty w złotych (liczby), stopy w procentach rocznie, okresy w miesiącach.

const num = (v) => (typeof v === "number" ? v : Number(String(v ?? "").replace(/\s/g, "").replace(",", ".")));
export const valid = (...vs) => vs.every((v) => Number.isFinite(v));

/** Rata równa (annuitetowa). rate = 0 → kapitał / n. */
export function annuity(principal, ratePct, months) {
  const P = num(principal), r = num(ratePct), n = Math.round(num(months));
  if (!valid(P, r, n) || P <= 0 || n <= 0 || r < 0) return null;
  const i = r / 100 / 12;
  return i === 0 ? P / n : (P * i) / (1 - Math.pow(1 + i, -n));
}

/** Kwota kredytu, którą spłaci podana rata (odwrotność annuity). */
export function principalFor(payment, ratePct, months) {
  const A = num(payment), r = num(ratePct), n = Math.round(num(months));
  if (!valid(A, r, n) || A <= 0 || n <= 0 || r < 0) return 0;
  const i = r / 100 / 12;
  return i === 0 ? A * n : (A * (1 - Math.pow(1 + i, -n))) / i;
}

/**
 * Harmonogram spłaty przy stałej stopie przez cały okres.
 * type: "rowne" | "malejace". Zwraca pierwszą/ostatnią ratę, sumy i podsumowanie roczne.
 */
export function schedule({ principal, ratePct, months, type = "rowne" }) {
  const P = num(principal), r = num(ratePct), n = Math.round(num(months));
  if (!valid(P, r, n) || P <= 0 || n <= 0 || n > 600 || r < 0 || r > 50) return null;
  const i = r / 100 / 12;
  const fixed = type === "rowne" ? annuity(P, r, n) : null;
  let balance = P, total = 0, interestSum = 0, first = 0, last = 0;
  const years = [];
  for (let m = 1; m <= n; m++) {
    const interest = balance * i;
    const capital = type === "rowne" ? fixed - interest : P / n;
    const pay = capital + interest;
    balance = Math.max(0, balance - capital);
    total += pay; interestSum += interest;
    if (m === 1) first = pay;
    last = pay;
    const y = Math.ceil(m / 12) - 1;
    years[y] ??= { year: y + 1, paid: 0, interest: 0, capital: 0, balance: 0 };
    years[y].paid += pay; years[y].interest += interest; years[y].capital += capital; years[y].balance = balance;
  }
  return { first, last, total, interest: interestSum, years };
}

/**
 * Orientacyjna zdolność kredytowa — scenariusz, NIE algorytm żadnego banku.
 * Maksymalna rata = min(dochód × limit DSTI − zobowiązania, dochód − zobowiązania − koszty życia).
 * Kwota liczona dwa razy: przy podanej stopie i przy stopie powiększonej o bufor.
 */
export function capacity({ income, obligations = 0, people = 1, livingCost = 1500, dstiPct = 40, ratePct, months, bufferPct = 2.5, ownContribution = 0 }) {
  const inc = num(income), obl = num(obligations), ppl = Math.max(1, Math.round(num(people))),
    lc = num(livingCost), dsti = num(dstiPct), r = num(ratePct), n = Math.round(num(months)),
    buf = num(bufferPct), own = num(ownContribution) || 0;
  if (!valid(inc, obl, lc, dsti, r, n, buf) || inc <= 0 || n <= 0 || r < 0) return null;
  const maxPayment = Math.max(0, Math.min(inc * dsti / 100 - obl, inc - obl - lc * ppl));
  const high = principalFor(maxPayment, r, n);
  const low = principalFor(maxPayment, r + buf, n);
  return { maxPayment, low, high, priceLow: low + own, priceHigh: high + own };
}

/**
 * Refinansowanie — symulacja: ten sam kapitał i okres, oprocentowanie niższe o podane punkty procentowe.
 * Bez kosztów zmiany, okresu zwrotu i oceny „opłaca się” (TZ 6.3). Scenariusze z ujemną stopą są pomijane.
 * currentPayment (opcjonalnie) — rata z harmonogramu banku; gdy brak, liczona z kapitału, okresu i stopy.
 */
export function refinanceScenarios({ balance, ratePct, months, currentPayment, cuts = [0.5, 1, 1.5] }) {
  const B = num(balance), r = num(ratePct), n = Math.round(num(months));
  if (!valid(B, r, n) || B <= 0 || n <= 0 || n > 600 || r < 0 || r > 50) return null;
  const calcCurrent = annuity(B, r, n);
  const given = num(currentPayment);
  const current = Number.isFinite(given) && given > 0 ? given : calcCurrent;
  const scenarios = cuts
    .map((cut) => Math.round((r - cut) * 100) / 100)
    .filter((rate) => rate >= 0)
    .map((rate) => {
      const payment = annuity(B, rate, n);
      return { rate, payment, monthly: current - payment, year: (current - payment) * Math.min(12, n) };
    });
  return { current, calcCurrent, usedGiven: current !== calcCurrent, scenarios };
}
