import { describe, expect, it } from "vitest";
import * as calcModule from "../../sites/adam/src/calc.mjs";

// Moduł JS strony Adama (sites/adam) — bez deklaracji typów.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { annuity, principalFor, schedule, capacity, refinance } = calcModule as any;

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

describe("refinansowanie", () => {
  it("niższa stopa → niższa rata, zwrot kosztów w miesiącach", () => {
    const r = refinance({ balance: 400000, currentRatePct: 8, newRatePct: 7, months: 300, costs: 3000 });
    expect(r.monthly).toBeCloseTo(annuity(400000, 8, 300) - annuity(400000, 7, 300), 6);
    expect(r.payback).toBe(Math.ceil(3000 / r.monthly));
    expect(r.worth).toBe(true);
  });
  it("wyższa nowa stopa → brak zwrotu, scenariusz nieopłacalny", () => {
    const r = refinance({ balance: 400000, currentRatePct: 6, newRatePct: 7, months: 300, costs: 0 });
    expect(r.payback).toBeNull();
    expect(r.worth).toBe(false);
  });
  it("koszty większe niż oszczędność w całym okresie → nieopłacalne", () => {
    const r = refinance({ balance: 50000, currentRatePct: 7.1, newRatePct: 7, months: 12, costs: 5000 });
    expect(r.worth).toBe(false);
  });
});
