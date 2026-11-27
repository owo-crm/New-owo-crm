import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as mod from "../../sites/adam/src/offers.mjs";

// Moduł JS strony Adama — bez deklaracji typów.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { offerErrors, loadOffers } = mod as any;

const ok = {
  id: "A-1",
  slug: "gdansk-wrzeszcz-3-pokoje",
  title: "Mieszkanie 3 pokoje z balkonem",
  city: "Gdańsk",
  district: "Wrzeszcz",
  type: "mieszkanie",
  area: 58.4,
  rooms: 3,
  price: 759000,
  status: "active",
  description: "Opis.",
  updated: "2026-12-01",
  images: [{ src: "/img/oferty/a1-salon.webp", alt: "Salon z balkonem" }],
  features: [["Balkon", "tak"]],
};
const file = (data: unknown) => {
  const dir = mkdtempSync(path.join(tmpdir(), "offers-"));
  const f = path.join(dir, "offers.json");
  writeFileSync(f, typeof data === "string" ? data : JSON.stringify(data));
  return f;
};

describe("plik ofert strony Adama", () => {
  it("poprawna oferta przechodzi; cena null = „na zapytanie”", () => {
    expect(offerErrors(ok)).toEqual([]);
    expect(offerErrors({ ...ok, price: null })).toEqual([]);
  });
  it("odrzuca braki i niebezpieczne wartości", () => {
    expect(offerErrors({ ...ok, slug: "Gdańsk Wrzeszcz" }).join()).toMatch(/slug/);
    expect(offerErrors({ ...ok, status: "draft" }).join()).toMatch(/status/);
    expect(offerErrors({ ...ok, images: [] }).join()).toMatch(/images/);
    expect(offerErrors({ ...ok, images: [{ src: "javascript:alert(1)", alt: "x" }] }).join()).toMatch(/src/);
    expect(offerErrors({ ...ok, images: [{ src: "/img/a.webp", alt: " " }] }).join()).toMatch(/alt/);
    expect(offerErrors({ ...ok, price: 759000.5 }).join()).toMatch(/price/);
  });
  it("plik: brak = pusty katalog; zły JSON i duplikaty — błąd, oferty nie są publikowane", () => {
    expect(loadOffers("/nie/ma/pliku.json")).toEqual({ offers: [], errors: [] });
    expect(loadOffers(file("{")).errors[0]).toMatch(/JSON/);
    const dup = loadOffers(file([ok, { ...ok, id: "A-2" }]));
    expect(dup.offers).toEqual([]);
    expect(dup.errors.join()).toMatch(/powtórzony slug/);
    expect(loadOffers(file([ok])).offers).toHaveLength(1);
  });
});
