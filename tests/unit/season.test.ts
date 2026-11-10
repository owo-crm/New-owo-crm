import { describe, expect, it } from "vitest";
import { buildSeason, countSaturdays, formatWaiting, seasonYear } from "@/lib/season";

describe("buildSeason", () => {
  const season = buildSeason(2027, { "2027-06-12": "booked", "2027-03-20": "inquiry" });

  it("в 2027 году 52 субботы, все действительно субботы", () => {
    const all = season.flatMap((m) => m.saturdays);
    expect(all).toHaveLength(52);
    for (const s of all) expect(new Date(`${s.iso}T12:00:00Z`).getUTCDay()).toBe(6);
  });

  it("первая суббота 2027 — 2 января, май начинается с 1-го", () => {
    expect(season[0].saturdays[0].iso).toBe("2027-01-02");
    expect(season[4].saturdays[0].iso).toBe("2027-05-01");
    expect(season[4].saturdays).toHaveLength(5);
  });

  it("статусы ставятся по дате, остальные свободны", () => {
    expect(countSaturdays(season, "booked")).toBe(1);
    expect(countSaturdays(season, "inquiry")).toBe(1);
    expect(countSaturdays(season, "free")).toBe(50);
  });
});

describe("seasonYear", () => {
  it.each([
    ["2026-10-12", 2027],
    ["2026-09-01", 2027],
    ["2027-08-31", 2027],
    ["2027-03-01", 2027],
  ])("%s → %s", (date, year) => {
    expect(seasonYear(new Date(`${date}T12:00:00`))).toBe(year);
  });
});

describe("formatWaiting", () => {
  it.each([
    [0, "0 min"],
    [47, "47 min"],
    [60, "1 godz."],
    [185, "3 godz."],
    [1440, "1 dzień"],
    [4320, "3 dni"],
    [-5, "0 min"],
  ])("%s → %s", (min, text) => {
    expect(formatWaiting(min)).toBe(text);
  });
});

it("сезон меняется в полночь Варшавы, независимо от часового пояса сервера", () => {
  expect(seasonYear(new Date("2026-08-31T21:59:59Z"))).toBe(2026);
  expect(seasonYear(new Date("2026-08-31T22:00:00Z"))).toBe(2027);
});
