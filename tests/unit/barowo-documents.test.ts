import { describe, expect, it } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { barowoEngine, legacyLeadRow } from "@/lib/documents/barowo/engine";

const lead = legacyLeadRow({
  client_name: "Zażółć Gęślą Jaźń",
  event_type: "wesele",
  event_date: "2027-06-12",
  event_city: "Gdynia",
  guests: 80,
});

describe("dokumenty Barowo (kod bota v48)", () => {
  it("oferta: domyślne wartości i cena z progów", () => {
    const e = barowoEngine();
    expect(e.suggestedOfferPrice_("standard", "80")).toBe(6900);
    expect(e.suggestedOfferPrice_("standard", "150")).toBe("");
    expect(e.defaultOfferValues_("premium").menu.split("\n")).toHaveLength(21);
  });
  it("oferta: PDF + DOCX z polskimi znakami", () => {
    const e = barowoEngine();
    const values = {
      ...e.defaultOfferValues_("standard"),
      guests: "80",
      venue: "Sala Złota, Gdynia",
      hours: "18:00-02:00",
      price: "6500",
      listPrice: "6900",
    };
    const snap = e.offerSnapshot_(lead, "standard", values);
    expect(snap.discount).toBe(400);
    snap.brandLayoutVersion = 1;
    snap.contact = "barowo.pl@gmail.com / +48 889 168 003";
    const pdf = e.brandedOfferPdf_(snap, "12 / 2026", "o.pdf");
    expect(Buffer.from(pdf.bytes.slice(0, 5)).toString()).toBe("%PDF-");
    expect(pdf.bytes.length).toBeGreaterThan(20_000);
    const docx = e.brandedOfferDocx_(snap, "12 / 2026", "o.docx");
    const files = unzipSync(docx.bytes);
    expect(Object.keys(files)).toContain("word/document.xml");
    expect(strFromU8(files["word/document.xml"])).toContain("Zażółć Gęślą Jaźń");
  });
  it("menu dla gości: PDF + DOCX, długie menu na kilka stron", () => {
    const e = barowoEngine();
    const menu = e.defaultOfferValues_("premium").menu;
    const snap = e.guestMenuSnapshot_({ menu }, lead);
    expect(snap.menu).toHaveLength(21);
    const pdf = e.guestMenuPdf_(snap, "m.pdf");
    expect(Buffer.from(pdf.bytes).toString("latin1")).toMatch(/\/Count [2-9]/);
    expect(unzipSync(e.guestMenuDocx_(snap, "m.docx").bytes)["word/document.xml"]).toBeTruthy();
  });
  it("walidacja z bota zostaje", () => {
    const e = barowoEngine();
    expect(() => e.parseDocumentHours_("18-2")).toThrow(/18:00-02:00/);
    expect(e.parseDocumentHours_("18:00 - 2:00")).toBe("18:00-02:00");
    expect(e.parseDocumentMoney_("6 500,50 zł")).toBe(6500.5);
  });
});
