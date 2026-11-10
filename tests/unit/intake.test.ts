import { describe, expect, it, vi } from "vitest";
import { createIntakeHandler, type IntakeDependencies } from "@/lib/channels/website";
const KEY = "40000000-0000-4000-8000-000000000001";
const channel = {
  id: KEY,
  organization_id: "40000000-0000-4000-8000-000000000002",
  name: "Strona",
  config: { allowedOrigins: ["https://example.com"] },
};
function setup(overrides: Partial<IntakeDependencies> = {}) {
  const saveLead = vi.fn().mockResolvedValue({ id: KEY, number: 1, duplicateIds: [] });
  const finishAttempt = vi.fn().mockResolvedValue(undefined);
  const deps: IntakeDependencies = {
    findChannel: vi.fn().mockResolvedValue(channel),
    hashIp: vi.fn().mockResolvedValue("a".repeat(64)),
    reserveAttempt: vi.fn().mockResolvedValue({ id: KEY, allowed: true }),
    finishAttempt,
    repository: { saveLead },
    now: () => new Date("2026-10-12T12:00:00Z"),
    ...overrides,
  };
  return { handler: createIntakeHandler(deps), deps, saveLead, finishAttempt };
}
function request(body: unknown, headers: Record<string, string> = {}, method = "POST") {
  return new Request(`https://test.supabase.co/functions/v1/intake/${KEY}`, {
    method,
    headers: { origin: "https://example.com", "content-type": "application/json", ...headers },
    body: method === "POST" ? JSON.stringify(body) : undefined,
  });
}
describe("website intake", () => {
  it("accepts JSON, preserves extra fields/UTM and ignores untrusted tenant fields", async () => {
    const { handler, saveLead, finishAttempt } = setup();
    const res = await handler(
      request({
        name: "Żaneta",
        phone: "600100200",
        consent: true,
        fontanna: "tak",
        utm_source: "google",
        organization_id: "foreign",
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("https://example.com");
    expect(saveLead).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: channel.organization_id,
        consentAt: "2026-10-12T12:00:00.000Z",
      }),
      expect.objectContaining({
        phone_e164: "+48600100200",
        custom_fields: { fontanna: "tak", organization_id: "foreign" },
        utm: { source: "google" },
      }),
    );
    expect(finishAttempt).toHaveBeenCalledWith(KEY, true, null);
  });
  it.each(["application/x-www-form-urlencoded", "multipart/form-data"])(
    "accepts %s",
    async (type) => {
      const { handler, saveLead } = setup();
      const form = new FormData();
      for (const [k, v] of Object.entries({
        name: "Anna",
        email: "ANNA@example.com",
        consent: "on",
        guests: "120",
      }))
        form.set(k, v);
      const req = new Request(`https://test/intake/${KEY}`, {
        method: "POST",
        headers: type.startsWith("application") ? { "content-type": type } : undefined,
        body: type.startsWith("application")
          ? new URLSearchParams(form as unknown as Record<string, string>)
          : form,
      });
      expect((await handler(req)).status).toBe(200);
      expect(saveLead).toHaveBeenCalledOnce();
    },
  );
  it("handles preflight without consuming limit", async () => {
    const { handler, deps } = setup();
    expect((await handler(request(null, {}, "OPTIONS"))).status).toBe(204);
    expect(deps.reserveAttempt).not.toHaveBeenCalled();
  });
  it.each([
    [{ name: "Anna", phone: "600100200", consent: false }, {}, 422],
    [{ name: "Anna", phone: "broken", consent: true }, {}, 422],
    [{ name: "Anna", phone: "600100200", consent: true }, { origin: "https://evil.example" }, 403],
    [{ website: "bot", consent: true }, {}, 200],
  ])("rejects invalid/spam requests without saving", async (body, headers, status) => {
    const { handler, saveLead, finishAttempt } = setup();
    expect((await handler(request(body, headers))).status).toBe(status);
    expect(saveLead).not.toHaveBeenCalled();
    expect(finishAttempt).toHaveBeenCalledOnce();
  });
  it("rate limits with Retry-After", async () => {
    const { handler, saveLead } = setup({
      reserveAttempt: vi.fn().mockResolvedValue({ id: KEY, allowed: false }),
    });
    const res = await handler(request({}));
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("3600");
    expect(saveLead).not.toHaveBeenCalled();
  });
  it("bounds body size even without a content-length header", async () => {
    const { handler, saveLead } = setup();
    expect((await handler(request({ message: "x".repeat(33000) }))).status).toBe(413);
    expect(saveLead).not.toHaveBeenCalled();
  });
  it("logs unsupported methods and malformed JSON", async () => {
    const { handler } = setup();
    expect((await handler(request(null, {}, "GET"))).status).toBe(405);
    expect(
      (
        await handler(
          new Request(`https://test/intake/${KEY}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: "{",
          }),
        )
      ).status,
    ).toBe(400);
  });
  it("returns 503 rather than claiming success on a database failure", async () => {
    const { handler } = setup({
      repository: { saveLead: vi.fn().mockRejectedValue(new Error("db")) },
    });
    expect(
      (await handler(request({ name: "Anna", phone: "600100200", consent: true }))).status,
    ).toBe(503);
  });
  it("takes the gateway-appended address, not a forged leftmost header", async () => {
    const { handler, deps } = setup();
    await handler(request({}, { "x-forwarded-for": "forged, 203.0.113.1" }));
    expect(deps.hashIp).toHaveBeenCalledWith("203.0.113.1");
  });
});

describe("formularze barowo.com (zgodność)", () => {
  function siteRequest(fields: Record<string, string>, accept = "application/json") {
    return new Request(`https://crm.test/api/intake/${KEY}`, {
      method: "POST",
      headers: {
        origin: "https://example.com",
        accept,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(fields).toString(),
    });
  }
  const site = {
    name: "Anna Nowak",
    phone: "500 100 200",
    event_date: "12.06.2027",
    guests: "50–100 osób",
    privacy_consent: "on",
    company: "",
    package: "Premium",
    return_url: "https://example.com/dziekujemy",
  };
  const barowoChannel = {
    ...channel,
    config: { allowedOrigins: ["https://example.com"], honeypotField: "company" },
  };

  it("privacy_consent, data dd.mm.rrrr, goście z zakresu, pola dodatkowe zachowane", async () => {
    const { handler, saveLead } = setup({ findChannel: vi.fn().mockResolvedValue(barowoChannel) });
    expect((await handler(siteRequest(site))).status).toBe(200);
    const lead = saveLead.mock.calls[0][1];
    expect(lead.event_date).toBe("2027-06-12");
    expect(lead.guests).toBe(100);
    expect(lead.custom_fields).toMatchObject({ guests_raw: "50–100 osób", package: "Premium" });
    expect(lead.custom_fields).not.toHaveProperty("company");
  });
  it("nieczytelna data nie blokuje zgłoszenia", async () => {
    const { handler, saveLead } = setup({ findChannel: vi.fn().mockResolvedValue(barowoChannel) });
    expect((await handler(siteRequest({ ...site, event_date: "czerwiec 2027" }))).status).toBe(200);
    expect(saveLead.mock.calls[0][1]).toMatchObject({
      event_date: null,
      custom_fields: { event_date_raw: "czerwiec 2027" },
    });
  });
  it("pułapka company zatrzymuje boty", async () => {
    const { handler, saveLead } = setup({ findChannel: vi.fn().mockResolvedValue(barowoChannel) });
    expect((await handler(siteRequest({ ...site, company: "spam sp. z o.o." }))).status).toBe(200);
    expect(saveLead).not.toHaveBeenCalled();
  });
  it("formularz bez JS: przekierowanie na return_url tylko w obrębie dozwolonej domeny", async () => {
    const { handler } = setup({ findChannel: vi.fn().mockResolvedValue(barowoChannel) });
    const ok = await handler(siteRequest(site, "text/html"));
    expect(ok.status).toBe(303);
    expect(ok.headers.get("location")).toBe("https://example.com/dziekujemy");
    const evil = await setup({ findChannel: vi.fn().mockResolvedValue(barowoChannel) }).handler(
      siteRequest({ ...site, return_url: "https://evil.example/x" }, "text/html"),
    );
    expect(evil.status).toBe(200);
  });
});
