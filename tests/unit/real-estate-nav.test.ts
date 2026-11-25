import { describe, expect, it } from "vitest";
import { NAV_ALL, navItems } from "@/components/app-shell/nav-items";
import { PRESETS, isRealEstate } from "@/lib/presets";

/** Кабинет агента недвижимости: только свои разделы; event-services и agency без изменений. */
describe("nawigacja real-estate", () => {
  const hrefs = (ctx: Parameters<typeof navItems>[0]) => navItems(ctx).map((i) => i.href);
  const all = ["documents", "calendar"];
  it("agent nieruchomości: bez agencji i bez umów eventowych", () => {
    const h = hrefs({ agency: false, modules: all, admin: true, preset: "real-estate" });
    expect(h).toEqual(
      expect.arrayContaining([
        "/dzisiaj",
        "/leady",
        "/kalendarz",
        "/ustawienia/zespol",
        "/ustawienia",
      ]),
    );
    expect(h).not.toContain("/umowy");
    expect(h.some((x) => x.startsWith("/agencja"))).toBe(false);
  });
  it("event-services i agency — jak wcześniej", () => {
    expect(hrefs({ agency: false, modules: all, admin: true, preset: "event-services" })).toContain(
      "/umowy",
    );
    expect(hrefs({ agency: true, modules: all, admin: true, preset: "agency" })).toContain(
      "/agencja",
    );
    expect(hrefs({ agency: false, modules: all, admin: true })).toEqual(
      NAV_ALL.filter((i) => !i.agency).map((i) => i.href),
    );
  });
  it("preset real-estate: etapy jak w migracji 0044", () => {
    expect(isRealEstate("real-estate")).toBe(true);
    expect(PRESETS["real-estate"].stages.map((s) => s.key)).toEqual([
      "new",
      "contacted",
      "consultation",
      "viewing",
      "negotiation",
      "contract",
      "won",
      "lost",
      "spam",
    ]);
  });
});
