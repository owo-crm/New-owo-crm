import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { strFromU8, unzipSync } from "fflate";
import { barowoEngine } from "@/lib/documents/barowo/engine";
import { contractSnapshot, contractTemplateValues } from "@/lib/documents/barowo/contract";
import { docxToPdf, fillDocxTemplate } from "@/lib/documents/docx-template";

const template = new Uint8Array(readFileSync("lib/documents/barowo/umowa-template.docx"));
const hasSoffice = (() => {
  try {
    execSync("command -v soffice", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();
const base = {
  date: "12.06.2099",
  city: "Gdynia",
  guests: "80",
  hours: "18:00-2:00",
  clientName: "Zażółć & Gęślą <Jaźń> Sp. z o.o.",
  address: "ul. Morska 1\n81-001 Gdynia",
  price: "6 500",
};

describe("umowa Barowo", () => {
  it("reguły z bota: data w przeszłości, zadatek, adres w jednej linii", () => {
    const e = barowoEngine();
    expect(() => contractSnapshot(e, "Standard", { ...base, date: "01.01.2020" })).toThrow(
      /przeszłości/,
    );
    expect(() => contractSnapshot(e, "Standard", { ...base, price: "1000" })).toThrow(/1500/);
    const s = contractSnapshot(e, "Standard", base, new Date(2099, 5, 1));
    expect(s.address).toBe("ul. Morska 1, 81-001 Gdynia");
    expect(s.hours).toBe("18:00-02:00");
    expect(s.balance).toBe(5000);
    expect(s.depositDate).toBe("05.06.2099");
  });
  it("szablon: wszystkie pola wypełnione, znaki XML bezpieczne", () => {
    const e = barowoEngine();
    const s = contractSnapshot(e, "Standard", base);
    const docx = fillDocxTemplate(template, contractTemplateValues(e, s, "7 / 2026"));
    const xml = strFromU8(unzipSync(docx)["word/document.xml"]);
    expect(xml).not.toMatch(/\{\{/);
    expect(xml).toContain("UMOWA NR 7 / 2026");
    expect(xml).toContain("Zażółć &amp; Gęślą &lt;Jaźń&gt;");
    expect(xml).toContain("6 500,00");
    expect(() => fillDocxTemplate(template, { UMOWA_NR: "1" })).toThrow(/Brak wartości/);
  });
  it.skipIf(!hasSoffice)(
    "PDF przez LibreOffice",
    async () => {
      const e = barowoEngine();
      const s = contractSnapshot(e, "Standard", base);
      const pdf = await docxToPdf(
        fillDocxTemplate(template, contractTemplateValues(e, s, "7 / 2026")),
      );
      expect(Buffer.from(pdf.slice(0, 5)).toString()).toBe("%PDF-");
    },
    120_000,
  );
});
