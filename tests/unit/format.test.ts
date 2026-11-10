import { describe, expect, it } from "vitest";
import { addMonths, formatWaiting, monthGrid, plDate, warsawToday } from "@/lib/format";

describe("format", () => {
  it("czas oczekiwania", () => {
    expect(formatWaiting(0)).toBe("0 min");
    expect(formatWaiting(59)).toBe("59 min");
    expect(formatWaiting(60)).toBe("1 godz.");
    expect(formatWaiting(1500)).toBe("1 dzień");
    expect(formatWaiting(2880)).toBe("2 dni");
    expect(formatWaiting(-5)).toBe("0 min");
  });
  it("daty", () => {
    expect(plDate("2027-06-12")).toBe("12.06.2027");
    expect(plDate(null)).toBe("");
    expect(addMonths("2026-01-01", -1)).toBe("2025-12-01");
    expect(addMonths("2026-12-01", 1)).toBe("2027-01-01");
    // Północ w Warszawie to jeszcze poprzedni dzień w UTC.
    expect(warsawToday(new Date("2026-06-11T23:30:00Z"))).toBe("2026-06-12");
  });
  it("siatka miesiąca zaczyna się w poniedziałek i obejmuje cały miesiąc", () => {
    const weeks = monthGrid("2026-11-01");
    expect(weeks[0][0].iso).toBe("2026-10-26");
    expect(weeks[0][0].inMonth).toBe(false);
    expect(weeks.flat().filter((d) => d.inMonth)).toHaveLength(30);
    expect(
      monthGrid("2026-02-01")
        .flat()
        .filter((d) => d.inMonth),
    ).toHaveLength(28);
  });
});
