import { createEmailPacer } from "@/lib/notify/pacing";
import { expect, it, vi } from "vitest";
import { runNotificationBatch, type Delivery, type QueueRepository } from "@/lib/notify/queue";
import { createIntakeHandler } from "@/lib/channels/website";
import { createTelegramBot, sendTelegramLead } from "@/lib/notify/telegram";
const ID = "82000000-0000-4000-8000-000000000001";
const lead = {
  id: ID,
  client_name: "Anna",
  phone_e164: "+48600100200",
  email: null,
  event_type: null,
  event_date: null,
  event_city: null,
  guests: null,
  message: "",
  source_label: "Test",
};
const job: Delivery = {
  id: ID,
  organization_id: ID,
  lead_id: ID,
  user_id: ID,
  channel: "telegram",
  kind: "new_lead",
  lease_token: ID,
  attempts: 1,
  created_at: new Date().toISOString(),
};
function repository(): QueueRepository {
  return {
    prepare: vi.fn().mockResolvedValue(undefined),
    claim: vi.fn().mockResolvedValue([job]),
    eligible: vi.fn().mockResolvedValue(lead),
    finish: vi.fn().mockResolvedValue(undefined),
  };
}
it("disabled batch never claims; skipped/failed jobs finish without throwing away others", async () => {
  const repo = repository();
  const sender = vi.fn().mockResolvedValue("sent");
  expect(await runNotificationBatch(repo, sender)).toMatchObject({ processed: 0, disabled: true });
  expect(repo.claim).not.toHaveBeenCalled();
  vi.mocked(repo.eligible).mockResolvedValue(null);
  await runNotificationBatch(repo, sender, { enabled: true });
  expect(sender).not.toHaveBeenCalled();
  expect(repo.finish).toHaveBeenCalledWith(job, "skipped", undefined);
  vi.mocked(repo.eligible).mockResolvedValue(lead);
  sender.mockRejectedValue(new Error("private provider details"));
  await runNotificationBatch(repo, sender, { enabled: true });
  expect(repo.finish).toHaveBeenCalledWith(job, "failed", "provider_failed");
});
it("POST intake starts mock Telegram delivery in under two seconds and waits in background", async () => {
  const request = vi.fn(async () =>
    Response.json({
      ok: true,
      result: { message_id: 1, chat: { id: 123, type: "private" }, date: 1, text: "test" },
    }),
  );
  const bot = createTelegramBot({
    token: "123:test",
    username: "BarowoCrmBot",
    repository: { redeem: vi.fn(), isLinked: vi.fn(), ingest: vi.fn(), contact: vi.fn() },
    siteUrl: "https://app.example.com",
    enabled: true,
    fetch: request,
  });
  const repo = repository();
  let background: Promise<unknown> | undefined;
  const handler = createIntakeHandler({
    findChannel: async () => ({ id: ID, organization_id: ID, name: "Test", config: {} }),
    reserveAttempt: async () => ({ id: ID, allowed: true }),
    finishAttempt: async () => {},
    hashIp: async () => "a".repeat(64),
    repository: { saveLead: async () => ({ id: ID, number: 1, duplicateIds: [] }) },
    afterIngest: async () => {
      await runNotificationBatch(
        repo,
        async (_job, lead) => {
          await sendTelegramLead(bot, lead, "123", "https://app.example.com", true);
          return "sent";
        },
        { enabled: true, leadId: ID },
      );
    },
    waitUntil: (promise) => {
      background = promise;
    },
  });
  const start = performance.now();
  const response = await handler(
    new Request(`https://test/intake/${ID}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Anna", phone: "600100200", consent: true }),
    }),
  );
  await background;
  expect(response.status).toBe(200);
  expect(request).toHaveBeenCalledOnce();
  expect(performance.now() - start).toBeLessThan(2000);
});

it("email bursts reserve staggered slots within one worker", async () => {
  const wait = vi.fn().mockResolvedValue(undefined);
  const pace = createEmailPacer(() => 1000, wait);
  await Promise.all([pace(), pace(), pace()]);
  expect(wait.mock.calls.map((call) => call[0])).toEqual([600, 1200]);
});
