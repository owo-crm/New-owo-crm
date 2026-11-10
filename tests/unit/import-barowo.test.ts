import { describe, expect, it } from "vitest";
import { isBarowoSheet, prepareBarowoImport } from "@/lib/leads/import-barowo";

const header = [
  "id",
  "created_time",
  "ad_id",
  "ad_name",
  "adset_id",
  "adset_name",
  "campaign_id",
  "campaign_name",
  "form_id",
  "form_name",
  "is_organic",
  "platform",
  "Rodzaj",
  "Ilosc_osob",
  "Data",
  "Miasto",
  "Imie",
  "Email",
  "Telefon",
  "lead_source",
  "lead_status",
  "telegram_status",
  "Przypisano",
  "Oferta",
  "Umowa",
  "Spam",
  "x",
  "Remind",
  "Notatka",
  "Historia",
  "NextCall",
  "CalId",
  "Goscie",
  "Pakiet",
  "Godziny",
  "Klient",
  "Adres",
];
function line(over: Record<number, string>) {
  const r = new Array(37).fill("");
  for (const [k, v] of Object.entries(over)) r[Number(k) - 1] = v;
  return r.map((c) => `"${c.replace(/"/g, '""')}"`).join(",");
}
const csv = [
  header.join(","),
  line({
    1: "a1b2c3d4",
    2: "2026-03-01T10:00:00.000Z",
    13: "Wesele",
    15: "'12.06.2027",
    16: "Gdynia",
    17: "Anna Nowak",
    18: "ANNA@x.pl",
    19: "'p:+48600100200",
    20: "meta_ads",
    21: "signed",
    23: "Ivan",
    25: "YES",
    29: "Chce Premium",
    33: "80 os.",
    34: "Premium",
    35: "18:00-02:00",
    37: "ul. Morska 1",
  }),
  line({
    1: "ffff0001",
    2: "05.04.2026 14:30:00",
    17: "Bez statusu",
    19: "600 200 300",
    24: "YES",
  }),
  line({ 1: "ffff0002", 2: "2026-03-02T10:00:00Z", 17: "Zły telefon", 19: "12", 18: "ok@x.pl" }),
  line({ 1: "ffff0003", 2: "2026-03-02T10:00:00Z", 17: "Bez kontaktu" }),
  line({
    1: "ffff0004",
    2: "2026-03-02T10:00:00Z",
    17: "Usunięty",
    19: "600100200",
    21: "deleted",
  }),
  line({ 1: "a1b2c3d4", 2: "2026-03-02T10:00:00Z", 17: "Duplikat", 19: "600100200" }),
].join("\n");

describe("import arkusza Lidy (bot Barowo)", () => {
  it("rozpoznaje arkusz po nagłówkach", () => {
    expect(isBarowoSheet(csv)).toBe(true);
    expect(isBarowoSheet("uid,name,phone\n1,a,b")).toBe(false);
  });
  it("mapuje kolumny, etapy i dane dodatkowe", () => {
    const plan = prepareBarowoImport(csv);
    expect(plan.valid).toHaveLength(3);
    const a = plan.valid[0].value;
    expect(a).toMatchObject({
      uid: "apps-script:a1b2c3d4",
      stage: "contract_signed",
      source: "meta_ads",
      assignedName: "Ivan",
      note: "Chce Premium",
    });
    expect(a.lead).toMatchObject({
      client_name: "Anna Nowak",
      phone_e164: "+48600100200",
      email: "anna@x.pl",
      event_date: "2027-06-12",
      guests: 80,
    });
    expect(a.extras).toMatchObject({ package_name: "Premium", client_address: "ul. Morska 1" });
    expect(plan.valid[1].value).toMatchObject({
      stage: "offer_sent",
      createdAt: "2026-04-05T13:30:00.000Z",
    });
    expect(plan.valid[2].value.lead).toMatchObject({
      phone_e164: null,
      email: "ok@x.pl",
      message: "Telefon (import): 12",
    });
    expect(plan.errors).toEqual([
      { row: 5, code: "no_contact" },
      { row: 7, code: "duplicate_uid" },
    ]);
    expect(plan.skipped).toBe(1);
  });
});
