import { describe, expect, it } from "vitest";
import {
  createWebhookHandler,
  flattenPayload,
  mapWebhookPayload,
  type WebhookChannel,
} from "@/lib/channels/webhook";
import type { IngestRepository } from "@/lib/leads/ingest";

/** Универсальный вебхук: распознавание полей из разных сервисов и путь заявки до CRM. */
describe("распознавание полей", () => {
  it("Zapier/Make: польские названия полей", () => {
    const r = mapWebhookPayload({
      "Imię i nazwisko": "Anna Nowak",
      Telefon: "500 100 200",
      Wiadomość: "Wesele 70 osób",
      Budżet: "8000",
    });
    expect(r.lead).toMatchObject({
      name: "Anna Nowak",
      phone: "500 100 200",
      message: "Wesele 70 osób",
    });
    expect(r.custom).toEqual({ Budżet: "8000" });
  });

  it("Google Ads lead form: user_column_data", () => {
    const r = mapWebhookPayload({
      lead_id: "abc",
      user_column_data: [
        { column_id: "FULL_NAME", string_value: "Jan Kowalski" },
        { column_id: "PHONE_NUMBER", string_value: "+48600700800" },
        { column_id: "EMAIL", string_value: "jan@example.com" },
        { column_id: "CITY", string_value: "Gdynia" },
      ],
    });
    expect(r.lead).toMatchObject({
      name: "Jan Kowalski",
      phone: "+48600700800",
      email: "jan@example.com",
      city: "Gdynia",
    });
  });

  it("first_name + last_name и вложенные объекты", () => {
    const r = mapWebhookPayload({
      contact: { first_name: "Ola", last_name: "Lis", email: "ola@x.pl" },
      utm_source: "fb",
    });
    expect(r.lead).toMatchObject({ name: "Ola Lis", email: "ola@x.pl" });
    expect(r.custom).toEqual({ utm_source: "fb" });
  });

  it("свои названия через fieldMap канала побеждают синонимы", () => {
    const r = mapWebhookPayload(
      { kto: "Piotr", nr: "511222333", phone: "000" },
      { kto: "name", nr: "phone" },
    );
    expect(r.lead).toMatchObject({ name: "Piotr", phone: "511222333" });
    expect(r.custom).toEqual({ phone: "000" });
  });

  it("Typeform/Tally: список ответов {label, value}", () => {
    expect(
      flattenPayload({
        fields: [
          { label: "E-mail", value: "a@b.pl" },
          { label: "Telefon", value: "500600700" },
        ],
      }),
    ).toEqual({
      "E-mail": "a@b.pl",
      Telefon: "500600700",
    });
  });
});

describe("обработчик вебхука", () => {
  const channel: WebhookChannel = {
    id: "00000000-0000-4000-8000-0000000000c1",
    organization_id: "00000000-0000-4000-8000-000000000001",
    name: "Zapier",
    config: {},
  };
  const KEY = "00000000-0000-4000-8000-0000000000aa";
  function setup(attempts = 0) {
    const logs: { ok: boolean; error: string | null; keys: string[] }[] = [];
    const saved: unknown[] = [];
    const repository: IngestRepository = {
      async saveLead(_ctx, lead) {
        saved.push(lead);
        return { id: "lead-1", number: 1, duplicateIds: [] };
      },
    };
    const handler = createWebhookHandler({
      findChannel: async (key) => (key === KEY ? channel : null),
      log: async (_c, ok, error, keys) => void logs.push({ ok, error, keys }),
      recentAttempts: async () => attempts,
      repository,
    });
    return { handler, logs, saved };
  }
  const post = (body: unknown, type = "application/json") =>
    new Request(`https://crm.test/api/hook/${KEY}`, {
      method: "POST",
      headers: { "content-type": type },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });

  it("JSON → лид, журнал без персональных данных (только названия полей)", async () => {
    const { handler, logs, saved } = setup();
    const res = await handler(post({ name: "Anna", phone: "500100200", extra: "x" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, lead_id: "lead-1" });
    expect(saved).toHaveLength(1);
    expect(logs).toEqual([{ ok: true, error: null, keys: ["name", "phone", "extra"] }]);
  });

  it("utm_campaign из вебхука попадает в utm лида (для вкладки «Reklama»)", async () => {
    const { handler, saved } = setup();
    await handler(
      post({
        name: "Ewa",
        phone: "500100200",
        utm_campaign: "Wesela jesień",
        utm_source: "facebook",
      }),
    );
    expect(saved[0]).toMatchObject({ utm: { campaign: "Wesela jesień", source: "facebook" } });
  });

  it("форма urlencoded тоже принимается", async () => {
    const { handler } = setup();
    const res = await handler(
      post("imie=Ola&telefon=500100200", "application/x-www-form-urlencoded"),
    );
    expect(res.status).toBe(200);
  });

  it("без телефона и e-mail — 422 с перечнем пришедших полей", async () => {
    const { handler, logs } = setup();
    const res = await handler(post({ who: "Anna" }));
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "no_contact", received_fields: ["who"] });
    expect(logs[0]).toMatchObject({ ok: false, error: "no_contact" });
  });

  it("чужой ключ — 404, превышен лимит — 429", async () => {
    expect(
      (await setup().handler(new Request("https://crm.test/api/hook/zzz", { method: "POST" })))
        .status,
    ).toBe(404);
    expect((await setup(300).handler(post({ phone: "500100200" }))).status).toBe(429);
  });
});
