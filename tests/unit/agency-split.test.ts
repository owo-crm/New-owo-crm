import { describe, expect, it } from "vitest";
import {
  DEFAULT_SHARES,
  sharePercent,
  splitOrder,
  totalsBySplit,
  validShares,
} from "@/lib/agency/split";

/** Формула раздела без базы (SQL-версия сверяется в tests/db/agency.test.ts). */
const A = "user-a";
const B = "user-b";
const sum = (lines: { amountGrosze: number }[]) => lines.reduce((s, l) => s + l.amountGrosze, 0);

describe("splitOrder", () => {
  it("10 / 25 / 65 от базы, база = сумма − прямые расходы", () => {
    const lines = splitOrder({
      amountGrosze: 110000,
      directCostsGrosze: 10000,
      sellers: [{ userId: A, shareBp: 10000 }],
      work: [{ userId: B, hours: 2 }],
    });
    expect(lines).toEqual([
      { userId: A, role: "sale", amountGrosze: 10000 },
      { userId: B, role: "work", amountGrosze: 65000 },
      { userId: null, role: "company", amountGrosze: 25000 },
    ]);
  });

  it("сумма строк совпадает с базой до гроша на тысяче случайных заказов", () => {
    let seed = 7;
    const rnd = (n: number) => ((seed = (seed * 48271) % 2147483647), seed % n);
    for (let i = 0; i < 1000; i++) {
      const amount = rnd(10_000_000);
      const costs = rnd(amount + 1);
      const work = Array.from({ length: rnd(4) }, (_, k) => ({
        userId: `u${k}`,
        hours: (rnd(5000) + 1) / 100,
      }));
      const lines = splitOrder({
        amountGrosze: amount,
        directCostsGrosze: costs,
        sellers: [{ userId: A, shareBp: 10000 }],
        work,
      });
      expect(sum(lines)).toBe(amount - costs);
      expect(lines.every((l) => Number.isInteger(l.amountGrosze) && l.amountGrosze >= 0)).toBe(
        true,
      );
    }
  });

  it("рекламный бюджет не влияет", () => {
    const base = {
      amountGrosze: 300000,
      directCostsGrosze: 0,
      sellers: [{ userId: A, shareBp: 10000 }],
      work: [],
    };
    expect(splitOrder({ ...base, adBudgetGrosze: 9_999_999 })).toEqual(splitOrder(base));
  });

  it("без часов работа видна как нераспределённая", () => {
    const t = totalsBySplit(
      splitOrder({ amountGrosze: 100000, directCostsGrosze: 0, sellers: [], work: [] }),
    );
    expect(t.unassignedGrosze).toBe(75000); // 65 % работы + 10 % продажи без продавца
    expect(t.companyGrosze).toBe(25000);
    expect(t.totalGrosze).toBe(100000);
  });

  it("один человек продал и сделал — 75 % в одной строке итога", () => {
    const t = totalsBySplit(
      splitOrder({
        amountGrosze: 100000,
        directCostsGrosze: 0,
        sellers: [{ userId: A, shareBp: 10000 }],
        work: [{ userId: A, hours: 1 }],
      }),
    );
    expect(t.people).toEqual([
      { userId: A, saleGrosze: 10000, workGrosze: 65000, totalGrosze: 75000 },
    ]);
  });

  it("доли проверяются и показываются в процентах", () => {
    expect(validShares(DEFAULT_SHARES)).toBe(true);
    expect(validShares({ saleBp: 1000, companyBp: 1000, workBp: 1000 })).toBe(false);
    expect(() =>
      splitOrder(
        {
          amountGrosze: 1,
          directCostsGrosze: 0,
          sellers: [{ userId: A, shareBp: 10000 }],
          work: [],
        },
        { saleBp: 1, companyBp: 1, workBp: 1 },
      ),
    ).toThrow();
    expect(sharePercent(1050).replace(/\s/g, " ")).toBe("10,5 %");
  });
});
