import { describe, expect, it } from "vitest";
import { normalizeLead } from "@/lib/leads/ingest";
import { prepareLeadPatch } from "@/lib/leads/edit";

/** Temat zapytania — osobne pole leada (zakup / sprzedaż / refinansowanie). */
describe("temat zapytania", () => {
  const base = { name: "Jan", phone: "600 100 200" };
  it("pole topic", () => {
    expect(normalizeLead({ ...base, topic: " Zakup mieszkania " }).topic).toBe("Zakup mieszkania");
  });
  it("starsze formularze: custom_fields.temat → topic", () => {
    const lead = normalizeLead({
      ...base,
      custom_fields: { temat: "Refinansowanie kredytu hipotecznego" },
    });
    expect(lead.topic).toBe("Refinansowanie kredytu hipotecznego");
    expect(lead.custom_fields.temat).toBe("Refinansowanie kredytu hipotecznego");
  });
  it("brak tematu → null; za długi temat odrzucony", () => {
    expect(normalizeLead(base).topic).toBeNull();
    expect(() => normalizeLead({ ...base, topic: "x".repeat(81) })).toThrow();
  });
  it("edycja tematu w karcie leada", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(prepareLeadPatch({} as any, "topic", "  Sprzedaż nieruchomości ")).toEqual({
      topic: "Sprzedaż nieruchomości",
    });
  });
});
