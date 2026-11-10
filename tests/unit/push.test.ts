import { expect, it, vi } from "vitest";
import { pushPayload, pushSubscriptionSchema, sendPushLead } from "@/lib/notify/push";
const lead = {
  id: "72000000-0000-4000-8000-000000000001",
  client_name: "Łucja 🎉",
  phone_e164: null,
  email: null,
  event_type: "Wesele",
  event_date: "2027-06-12",
  event_city: "Gdynia",
  guests: null,
  message: "",
  source_label: "Strona",
};
const subscription = {
  endpoint: "https://fcm.googleapis.com/fcm/send/test",
  keys: { p256dh: "a".repeat(87), auth: "b".repeat(22) },
};
const vapid = { subject: "mailto:owner@example.com", publicKey: "test", privateKey: "test" };
it("push payload points to a lead and never trusts an external click URL", () => {
  expect(pushPayload(lead, "https://app.example.com")).toMatchObject({
    title: "🔔 Nowy lead: Łucja 🎉",
    body: "Wesele · 12.06.2027 · Gdynia",
    url: `/leady/${lead.id}`,
  });
  for (const endpoint of [
    "http://127.0.0.1/test",
    "https://evil.example/test",
    "https://user@fcm.googleapis.com/test",
  ])
    expect(pushSubscriptionSchema.safeParse({ ...subscription, endpoint }).success).toBe(false);
});
it("default is disabled; active sender uses only injected mock and expires 410 endpoints", async () => {
  const transport = vi.fn().mockResolvedValue({});
  expect(
    await sendPushLead(subscription, lead, "https://app.example.com", vapid, false, transport),
  ).toEqual({ status: "disabled" });
  expect(transport).not.toHaveBeenCalled();
  expect(
    await sendPushLead(subscription, lead, "https://app.example.com", vapid, true, transport),
  ).toEqual({ status: "sent" });
  transport.mockRejectedValue({ statusCode: 410 });
  expect(
    await sendPushLead(subscription, lead, "https://app.example.com", vapid, true, transport),
  ).toEqual({ status: "expired" });
});
