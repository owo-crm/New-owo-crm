import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { defaultImportMapping, prepareCsvImport } from "@/lib/leads/import";
import { hasKnownResponse } from "@/lib/leads/response";
it("CSV handles Polish, emoji, quoted commas/newlines, normalized contacts, money and dates", () => {
  const result = prepareCsvImport(readFileSync("tests/fixtures/apps-script-leads.csv", "utf8"));
  expect(result.errors).toEqual([]);
  expect(result.valid).toHaveLength(2);
  expect(result.valid[0].value).toMatchObject({
    uid: "apps-script:L-001",
    stage: "new",
    lead: {
      client_name: "Łucja Żółć 🎉",
      phone_e164: "+48600100200",
      budget_grosze: 125005,
      event_date: "2027-06-12",
      message: "Dzień dobry,\nproszę o ofertę.",
    },
  });
  expect(result.valid[1].value.lead.email).toBe("anna@example.com");
});
it("mapping is explicit; duplicate IDs, invalid stages/dates and headers are reported", () => {
  const csv =
    "ID;Customer;email;stage;created_at\nL1;Anna;a@example.com;new;2026-01-01T12:00:00Z\nL1;Anna;a@example.com;new;2026-01-01T12:00:00Z\nL2;Anna;a@example.com;unknown;2026-01-01T12:00:00Z";
  const result = prepareCsvImport(
    csv,
    { ...defaultImportMapping, uid: "ID", name: "Customer" },
    ";",
  );
  expect(result.valid).toHaveLength(1);
  expect(result.errors).toEqual([
    { row: 3, code: "duplicate_uid" },
    { row: 4, code: "unknown_stage" },
  ]);
  expect(() => prepareCsvImport("uid,uid\n1,2")).toThrow("duplicate_headers");
  const invalid = prepareCsvImport(
    "uid,name,email,stage,created_at,event_date\nX,Anna,a@example.com,new,2026-01-01T12:00:00Z,31.02.2027",
  );
  expect(invalid.errors).toHaveLength(1);
});
it("historical contact hides the unanswered badge without inventing a response timestamp", () => {
  expect(
    hasKnownResponse({
      first_response_at: null,
      stage_key: "contacted",
      legacy_uid: "apps-script:1",
    }),
  ).toBe(true);
  expect(
    hasKnownResponse({ first_response_at: null, stage_key: "new", legacy_uid: "apps-script:1" }),
  ).toBe(false);
  expect(hasKnownResponse({ first_response_at: null, stage_key: "new" })).toBe(false);
});
