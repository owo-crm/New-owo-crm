import { describe, expect, it, vi } from "vitest";
import { ingestLead, normalizeLead, normalizePhone } from "@/lib/leads/ingest";

describe("lead normalization", () => {
  it.each(["600 100 200", "+48 (600) 100-200", "0048 600100200", "48600100200"])(
    "normalizes Polish phone %s",
    (value) => {
      expect(normalizePhone(value)).toBe("+48600100200");
    },
  );
  it("keeps explicit foreign country codes", () =>
    expect(normalizePhone("+44 7700 900123")).toBe("+447700900123"));
  it.each(["123", "+48 12345678", "600100200 ext 1", "++48600100200"])(
    "rejects invalid phone %s",
    (value) => expect(() => normalizePhone(value)).toThrow(),
  );
  it("normalizes email, optional fields and integer money", () => {
    const lead = normalizeLead({
      name: "  Łucja Żółć 🎉 ",
      email: "ANNA@EXAMPLE.COM ",
      guests: "120",
      budget_grosze: "125000",
      custom_fields: { fontanna: true },
      event_date: "2028-02-29",
    });
    expect(lead).toMatchObject({
      client_name: "Łucja Żółć 🎉",
      email: "anna@example.com",
      phone_e164: null,
      guests: 120,
      budget_grosze: 125000,
      event_date: "2028-02-29",
      custom_fields: { fontanna: true },
    });
  });
  it.each([
    { name: "Anna" },
    { name: "", phone: "600100200" },
    { name: "Anna", email: "broken" },
    { name: "Anna", phone: "600100200", event_date: "2027-02-29" },
    { name: "Anna", phone: "600100200", guests: -1 },
    { name: "Anna", phone: "600100200", budget_grosze: 1.5 },
  ])("rejects invalid input %j before writing", async (input) => {
    const saveLead = vi.fn();
    await expect(
      ingestLead(
        input,
        {
          organizationId: "10000000-0000-4000-8000-000000000001",
          channelId: null,
          sourceLabel: "Ręcznie",
          consentAt: null,
        },
        { saveLead },
      ),
    ).rejects.toThrow();
    expect(saveLead).not.toHaveBeenCalled();
  });
  it("ignores untrusted stage, organization and actor fields", () => {
    const result = normalizeLead({
      name: "Anna",
      phone: "600100200",
      organization_id: "foreign",
      stage_key: "won",
      actor_user_id: "other",
    });
    expect(result).not.toHaveProperty("organization_id");
    expect(result).not.toHaveProperty("stage_key");
  });
});
