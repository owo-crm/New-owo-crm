import { describe, expect, it } from "vitest";
import { barowoSchedule } from "@/lib/finance/payments";
import { paymentSteps } from "@/components/finance/payment-roadmap";

/** План предоплат (решение 049): суммы из настроек, остаток — до полной цены. */
describe("план платежей", () => {
  const dates = { depositDate: "2027-01-27", eventDate: "2027-02-03", today: "2026-11-18" };
  it("по умолчанию 500 + 1000 + остаток", () => {
    const rows = barowoSchedule({ priceGrosze: 900000, ...dates });
    expect(rows.map((r) => [r.amount_grosze, r.due_date])).toEqual([
      [50000, "2026-11-18"],
      [100000, "2027-01-27"],
      [750000, "2027-02-03"],
    ]);
  });
  it("свой план: три предоплаты; цена меньше плана — без остатка", () => {
    const rows = barowoSchedule({ priceGrosze: 120000, plan: [30000, 30000, 100000], ...dates });
    expect(rows.map((r) => r.amount_grosze)).toEqual([30000, 30000, 60000]);
  });
  it("змейка до договора: план + «Reszta» от бюджета", () => {
    const steps = paymentSteps([], [50000, 100000], 900000);
    expect(steps.map((s) => s.amount)).toEqual([50000, 100000, 750000]);
    expect(paymentSteps([], [50000], null).at(-1)).toMatchObject({ amount: null });
  });
});
