import { expect, it, vi } from "vitest";
import {
  createTelegramBot,
  sendTelegramLead,
  telegramManualInput,
  telegramMessage,
  tokenHash,
  type TelegramRepository,
} from "@/lib/notify/telegram";
const ID = "71000000-0000-4000-8000-000000000001";
const lead = {
  id: ID,
  client_name: "Żaneta <script> 🎉",
  phone_e164: null,
  email: null,
  event_type: null,
  event_date: null,
  event_city: null,
  guests: null,
  message: "A & B",
  source_label: "Strona",
};
function setup(enabled = true) {
  const calls: unknown[] = [];
  const fetchMock: typeof fetch = vi.fn(async (_url, init) => {
    calls.push(init?.body);
    return Response.json({
      ok: true,
      result: { message_id: 1, chat: { id: 123, type: "private" }, date: 1, text: "test" },
    });
  });
  const repository: TelegramRepository = {
    redeem: vi.fn().mockResolvedValue(true),
    isLinked: vi.fn().mockResolvedValue(true),
    ingest: vi.fn().mockResolvedValue({ id: ID }),
    contact: vi.fn().mockResolvedValue(false),
  };
  const bot = createTelegramBot({
    token: "123:test",
    username: "BarowoCrmBot",
    repository,
    siteUrl: "https://app.example.com",
    enabled,
    fetch: fetchMock,
  });
  return { bot, repository, calls, fetchMock };
}
function command(text: string) {
  return {
    update_id: 1,
    message: {
      message_id: 1,
      date: 1,
      chat: { id: 123, type: "private" as const, first_name: "Test" },
      from: { id: 456, is_bot: false, first_name: "Test" },
      text,
      entities: [{ offset: 0, length: text.split(" ")[0].length, type: "bot_command" as const }],
    },
  };
}
it("escapes client content and handles missing details", () => {
  const message = telegramMessage(lead);
  expect(message).toContain("&lt;script&gt;");
  expect(message).toContain("A &amp; B");
  expect(message).not.toContain("undefined");
  expect(message).toContain("Data do ustalenia");
  expect(telegramManualInput("Anna | 600 100 200 | 12.06.2027 | Gdynia | Wesele")).toMatchObject({
    client_name: "Anna",
    phone_e164: "+48600100200",
    event_date: "2027-06-12",
  });
});
it("outbound is off by default and never calls transport", async () => {
  const { bot, fetchMock } = setup(false);
  expect(await sendTelegramLead(bot, lead, "123", "https://app.example.com")).toEqual({
    status: "disabled",
  });
  expect(fetchMock).not.toHaveBeenCalled();
});
it("notification buttons and bot commands only call mock Telegram API", async () => {
  const { bot, repository, fetchMock } = setup();
  await sendTelegramLead(bot, lead, "123", "https://app.example.com", true);
  await bot.handleUpdate(command(`/start ${"a".repeat(64)}`));
  expect(repository.redeem).toHaveBeenCalledWith(await tokenHash("a".repeat(64)), "123", "456");
  await bot.handleUpdate({ ...command("/nowylead Anna | 600100200 | 12.06.2027"), update_id: 2 });
  expect(repository.ingest).toHaveBeenCalledWith(
    "123",
    "456",
    expect.objectContaining({ client_name: "Anna" }),
    2,
  );
  expect(fetchMock).toHaveBeenCalledTimes(3);
});
it("invalid data or unlinked chat cannot create a lead", async () => {
  const { bot, repository } = setup();
  await bot.handleUpdate(command("/nowylead Anna | broken"));
  expect(repository.ingest).not.toHaveBeenCalled();
  vi.mocked(repository.isLinked).mockResolvedValue(false);
  await bot.handleUpdate(command("/nowylead Anna | 600100200"));
  expect(repository.ingest).not.toHaveBeenCalled();
});
