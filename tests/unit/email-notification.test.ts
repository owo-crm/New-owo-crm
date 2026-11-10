import { expect, it, vi } from "vitest";
import { emailContent, sendEmailLead } from "@/lib/notify/email";
const lead = {
  id: "73000000-0000-4000-8000-000000000001",
  client_name: "Łucja <script>\n🎉",
  phone_e164: null,
  email: "client@example.com",
  event_type: null,
  event_date: null,
  event_city: null,
  guests: null,
  message: "private customer message",
  source_label: "Strona",
};
it("email escapes data, does not invent details or include the client's private message", () => {
  const content = emailContent(lead, "https://app.example.com");
  expect(content.html).toContain("&lt;script&gt;");
  expect(content.subject).not.toContain("\n");
  expect(content.text).not.toContain("private customer message");
  expect(content.text).not.toContain("undefined");
  expect(emailContent(lead, "https://app.example.com", "unanswered_15m").subject).toContain(
    "15 minut",
  );
});
it("default is off, active transport is mocked and retries reuse the same key", async () => {
  const request = vi.fn().mockResolvedValue(Response.json({ id: "provider-1" }));
  const options = {
    lead,
    recipient: "owner@example.com",
    from: "alerts@example.com",
    apiKey: "test",
    deliveryId: lead.id,
    siteUrl: "https://app.example.com",
    fetch: request,
  };
  expect(await sendEmailLead(options)).toEqual({ status: "disabled" });
  expect(request).not.toHaveBeenCalled();
  request.mockImplementation(async () => Response.json({ id: "provider-1" }));
  await sendEmailLead({ ...options, enabled: true });
  await sendEmailLead({ ...options, enabled: true });
  const first = request.mock.calls[0][1] as RequestInit;
  const second = request.mock.calls[1][1] as RequestInit;
  expect(new Headers(first.headers).get("Idempotency-Key")).toBe(
    new Headers(second.headers).get("Idempotency-Key"),
  );
  expect(JSON.parse(String(first.body)).to).toEqual(["owner@example.com"]);
  request.mockResolvedValue(Response.json({}, { status: 429 }));
  await expect(sendEmailLead({ ...options, enabled: true })).rejects.toThrow("resend_http_429");
});
