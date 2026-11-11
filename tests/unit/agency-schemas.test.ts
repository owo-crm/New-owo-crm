import { describe, expect, it } from "vitest";
import {
  clientInputSchema,
  moneyFieldValue,
  orderInputSchema,
  parseHours,
  parseMoneyField,
} from "@/lib/agency/schemas";

const U = "00000000-0000-4000-8000-000000000001";
const order = {
  clientId: U,
  title: "Landing page",
  kind: "project",
  amountGrosze: 150000,
  directCostsGrosze: 0,
  adBudgetGrosze: 0,
  sellers: [{ userId: U, shareBp: 10000 }],
  workBasis: "hours",
  costs: [],
  periodMonth: "2026-11",
  status: "draft",
  dueDate: null,
  work: [{ userId: U, hours: 2.5 }],
};

describe("формы агентства", () => {
  it("суммы и часы из полей ввода", () => {
    expect(parseMoneyField("1 499,99 zł")).toBe(149999);
    expect(parseMoneyField("")).toBe(0);
    expect(parseMoneyField("abc")).toBeNaN();
    expect(moneyFieldValue(149905)).toBe("1499,05");
    expect(moneyFieldValue(0)).toBe("");
    expect(parseHours("12,5")).toBe(12.5);
    expect(parseHours("1,234")).toBeNaN();
  });

  it("заказ: расходы не больше суммы, исполнитель один раз, часы с точностью 0,01", () => {
    expect(orderInputSchema.safeParse(order).success).toBe(true);
    expect(orderInputSchema.safeParse({ ...order, directCostsGrosze: 150001 }).success).toBe(false);
    // Продавцы: доли не больше 100 % в сумме, один человек — один раз.
    expect(
      orderInputSchema.safeParse({
        ...order,
        sellers: [
          { userId: U, shareBp: 6000 },
          { userId: U, shareBp: 6000 },
        ],
      }).success,
    ).toBe(false);
    // Строки расходов обязаны давать сумму прямых расходов.
    expect(
      orderInputSchema.safeParse({
        ...order,
        directCostsGrosze: 5000,
        costs: [{ label: "Druk", amountGrosze: 4000, paidTo: null }],
      }).success,
    ).toBe(false);
    expect(
      orderInputSchema.safeParse({ ...order, work: [order.work[0], order.work[0]] }).success,
    ).toBe(false);
    expect(
      orderInputSchema.safeParse({ ...order, work: [{ userId: U, hours: 1.234 }] }).success,
    ).toBe(false);
    expect(
      orderInputSchema.safeParse({ ...order, work: [{ userId: U, hours: 501 }] }).success,
    ).toBe(false);
  });

  it("клиент: NIP без пробелов и дефисов, пустые поля → null", () => {
    const r = clientInputSchema.parse({
      name: "Studio",
      nip: "123-456-78 90",
      contactName: "",
      phone: "",
      email: " Ola@Studio.PL ",
      city: "",
      status: "active",
      startedAt: "",
      note: "",
    });
    expect(r).toMatchObject({
      nip: "1234567890",
      email: "ola@studio.pl",
      city: null,
      startedAt: null,
    });
    expect(clientInputSchema.safeParse({ ...r, nip: "12", email: "", startedAt: "" }).success).toBe(
      false,
    );
  });
});
