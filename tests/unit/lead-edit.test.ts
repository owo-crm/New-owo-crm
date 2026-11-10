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
