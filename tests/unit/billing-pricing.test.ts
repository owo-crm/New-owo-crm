import { describe, expect, it } from "vitest";
import { calculatePrice } from "@/lib/billing/pricing";

describe("цена подписки", () => {
  it("только канал с сайта — 39 zł netto, 47,97 zł brutto", () => {
    const p = calculatePrice({ modules: ["leads"], seats: 1 });
    expect(p.netGrosze).toBe(3900);
    expect(p.vatGrosze).toBe(897);
    expect(p.grossGrosze).toBe(4797);
  });

  it("модули суммируются, каждый пользователь сверх первого +15 zł", () => {
    const p = calculatePrice({ modules: ["leads", "documents", "payments"], seats: 3 });
    expect(p.lines.map((l) => [l.key, l.totalGrosze])).toEqual([
      ["leads", 3900],
      ["documents", 5900],
      ["payments", 2900],
      ["seats", 3000],
    ]);
    expect(p.netGrosze).toBe(15700);
  });

  it("все модули → Pakiet Pełny 149 zł с тремя пользователями", () => {
    const p = calculatePrice({
      modules: ["leads", "channels", "documents", "payments", "calendar"],
      seats: 4,
    });
    expect(p.bundle).toBe(true);
    expect(p.lines.map((l) => [l.key, l.totalGrosze])).toEqual([
      ["bundle", 14900],
      ["seats", 1500],
    ]);
  });

  it("клиент рекламы: база бесплатно, модули −50 %, берётся то, что дешевле", () => {
    const p = calculatePrice({ modules: ["leads", "documents"], seats: 1, adClient: true });
    expect(p.lines.map((l) => [l.key, l.totalGrosze])).toEqual([
      ["leads", 0],
      ["documents", 2950],
    ]);
    const all = calculatePrice({
      modules: ["leads", "channels", "documents", "payments", "calendar"],
      seats: 1,
      adClient: true,
    });
    // Модули по отдельности: 0 + (29+59+29+19)/2 = 68 zł < пакет 74,50 zł.
    expect(all.bundle).toBe(false);
    expect(all.netGrosze).toBe(6800);
  });

  it("дополнительная скидка и рост суммы при добавлении модуля", () => {
    const before = calculatePrice({ modules: ["leads"], seats: 1, discountBp: 1000 });
    const after = calculatePrice({ modules: ["leads", "calendar"], seats: 1, discountBp: 1000 });
    expect(before.netGrosze).toBe(3510);
    expect(after.netGrosze - before.netGrosze).toBe(1710);
  });
});
