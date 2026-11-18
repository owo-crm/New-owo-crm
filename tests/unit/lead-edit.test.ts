import { expect, it } from "vitest";
import { parseMoney } from "@/lib/leads/edit";
it("converts Polish zł to integer grosze without rounding fractions", () => {
  expect(parseMoney("1250,05")).toBe(125005);
  expect(parseMoney("0.1")).toBe(10);
  expect(parseMoney("")).toBeNull();
  expect(() => parseMoney("1.234")).toThrow();
  expect(() => parseMoney("-1")).toThrow();
  expect(() => parseMoney("99999999")).toThrow();
});

it("next_contact_at: дата и время по Варшаве, пусто — снять", async () => {
  const { prepareLeadPatch } = await import("@/lib/leads/edit");
  const lead = {} as Parameters<typeof prepareLeadPatch>[0];
  expect(prepareLeadPatch(lead, "next_contact_at", "2026-12-03T14:00")).toEqual({
    next_contact_at: "2026-12-03 14:00:00 Europe/Warsaw",
  });
  expect(prepareLeadPatch(lead, "next_contact_at", "")).toEqual({ next_contact_at: null });
  expect(() => prepareLeadPatch(lead, "next_contact_at", "jutro")).toThrow();
});
