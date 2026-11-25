import { describe, expect, it } from "vitest";
import * as calcModule from "../../sites/adam/src/calc.mjs";

// Moduł JS strony Adama (sites/adam) — bez deklaracji typów.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { annuity, principalFor, schedule, capacity, refinanceScenarios } = calcModule as any;

/** Kalkulatory strony Adama: kontrolne przykłady liczone niezależnie. */

describe("rata kredytu", () => {
  it("rata równa: 300 000 zł, 7%, 30 lat ≈ 1995,91 zł", () => {
    expect(annuity(300000, 7, 360)).toBeCloseTo(1995.91, 2);
  });
  it("stopa 0% → kapitał / liczba rat", () => {
    expect(annuity(120000, 0, 120)).toBe(1000);
  });
  it("principalFor odwraca annuity", () => {
    expect(principalFor(annuity(450000, 6.5, 300), 6.5, 300)).toBeCloseTo(450000, 4);
  });
  it("raty malejące: pierwsza = kapitał/n + odsetki pierwszego miesiąca", () => {
    const s = schedule({ principal: 300000, ratePct: 7, months: 360, type: "malejace" });
    expect(s.first).toBeCloseTo(300000 / 360 + 1750, 6);
    expect(s.interest).toBeCloseTo((300000 * 0.07 / 12) * (361 / 2), 2); // suma odsetek ciągu arytmetycznego
  });
  it("raty równe: suma = rata × n, saldo końcowe 0", () => {
    const s = schedule({ principal: 300000, ratePct: 7, months: 360 });
    expect(s.total).toBeCloseTo(annuity(300000, 7, 360) * 360, 4);
    expect(s.years.at(-1).balance).toBeCloseTo(0, 4);
    expect(s.years).toHaveLength(30);
  });
  it("odrzuca błędne dane", () => {
    expect(annuity(-1, 7, 360)).toBeNull();
    expect(annuity(1000, 7, 0)).toBeNull();
    expect(schedule({ principal: "", ratePct: 7, months: 360 })).toBeNull();
    expect(schedule({ principal: 1000, ratePct: 7, months: 1000 })).toBeNull();
  });
  it("akceptuje polski zapis liczb", () => {
    expect(annuity("300 000", "7,0", "360")).toBeCloseTo(1995.91, 2);
  });
});

describe("zdolność kredytowa (scenariusz)", () => {
  it("rata ograniczona limitem DSTI i kosztami życia", () => {
    const r = capacity({ income: 10000, obligations: 500, people: 2, livingCost: 1500, dstiPct: 40, ratePct: 7, months: 360 });
    expect(r.maxPayment).toBe(3500); // min(4000−500, 10000−500−3000)
    expect(r.high).toBeCloseTo(principalFor(3500, 7, 360), 6);
    expect(r.low).toBeLessThan(r.high); // bufor obniża kwotę
  });
  it("koszty przewyższają dochód → 0, bez wartości ujemnych", () => {
    const r = capacity({ income: 3000, obligations: 2000, people: 3, ratePct: 7, months: 360 });
    expect(r.maxPayment).toBe(0);
    expect(r.high).toBe(0);
  });
});

describe("refinansowanie — scenariusze obniżki oprocentowania", () => {
  it("trzy scenariusze: −0,5 / −1 / −1,5 p.p., ten sam kapitał i okres", () => {
    const r = refinanceScenarios({ balance: 400000, ratePct: 8, months: 300 });
    expect(r.current).toBeCloseTo(annuity(400000, 8, 300), 6);
    expect(r.scenarios.map((x: { rate: number }) => x.rate)).toEqual([7.5, 7, 6.5]);
    const s1 = r.scenarios[1];
    expect(s1.payment).toBeCloseTo(annuity(400000, 7, 300), 6);
    expect(s1.monthly).toBeCloseTo(r.current - s1.payment, 6);
    expect(s1.year).toBeCloseTo(s1.monthly * 12, 6);
  });
  it("rata z harmonogramu zastępuje wyliczoną", () => {
    const r = refinanceScenarios({ balance: 400000, ratePct: 8, months: 300, currentPayment: "3 200" });
    expect(r.current).toBe(3200);
    expect(r.usedGiven).toBe(true);
    expect(r.scenarios[0].monthly).toBeCloseTo(3200 - annuity(400000, 7.5, 300), 6);
  });
  it("pomija scenariusze z ujemną stopą", () => {
    const r = refinanceScenarios({ balance: 100000, ratePct: 0.8, months: 120 });
    expect(r.scenarios.map((x: { rate: number }) => x.rate)).toEqual([0.3]);
  });
  it("krótki okres: różnica „12 miesięcy” liczona tylko za pozostałe raty", () => {
    const r = refinanceScenarios({ balance: 10000, ratePct: 8, months: 6 });
    expect(r.scenarios[0].year).toBeCloseTo(r.scenarios[0].monthly * 6, 6);
  });
  it("odrzuca błędne dane", () => {
    expect(refinanceScenarios({ balance: 0, ratePct: 8, months: 300 })).toBeNull();
    expect(refinanceScenarios({ balance: 1000, ratePct: -1, months: 300 })).toBeNull();
    expect(refinanceScenarios({ balance: 1000, ratePct: 8, months: "" })).toBeNull();
  });
});
