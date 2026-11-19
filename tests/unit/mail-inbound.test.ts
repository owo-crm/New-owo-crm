import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  htmlToText,
  parseAddress,
  receivedEvent,
  replySubject,
  stripQuote,
  verifyWebhook,
} from "@/lib/mail/inbound";

const SECRET = "whsec_" + Buffer.from("tajny-klucz-podpisu-123").toString("base64");

function sign(body: string, id = "msg_1", ts = 1_800_000_000) {
  const key = Buffer.from(SECRET.slice(6), "base64");
  const sig = createHmac("sha256", key).update(`${id}.${ts}.${body}`).digest("base64");
  return { id, timestamp: String(ts), signature: `v1,${sig}` };
}

describe("подпись вебхука Resend", () => {
  const body = '{"type":"email.received"}';
  it("верная подпись принимается", () => {
    expect(verifyWebhook(SECRET, sign(body), body, 1_800_000_010)).toBe(true);
  });
  it("подделанное тело, чужой секрет, старый запрос — отказ", () => {
    expect(verifyWebhook(SECRET, sign(body), body + " ", 1_800_000_010)).toBe(false);
    expect(verifyWebhook("whsec_aW5ueQ==", sign(body), body, 1_800_000_010)).toBe(false);
    expect(verifyWebhook(SECRET, sign(body), body, 1_800_000_000 + 600)).toBe(false);
    expect(verifyWebhook(SECRET, { id: null, timestamp: null, signature: null }, body)).toBe(false);
  });
  it("несколько подписей в заголовке (смена ключа)", () => {
    const s = sign(body);
    expect(
      verifyWebhook(SECRET, { ...s, signature: `v1,zzzz ${s.signature}` }, body, 1_800_000_000),
    ).toBe(true);
  });
});

describe("разбор письма", () => {
  it("адрес с именем", () => {
    expect(parseAddress('"Anna Nowak" <Anna@Example.com>')).toEqual({
      email: "anna@example.com",
      name: "Anna Nowak",
    });
    expect(parseAddress("jan@x.pl")).toEqual({ email: "jan@x.pl", name: null });
  });
  it("HTML → текст без стилей и тегов", () => {
    expect(htmlToText("<style>p{}</style><p>Dzień&nbsp;dobry</p><p>Tak &amp; nie<br>OK</p>")).toBe(
      "Dzień dobry\nTak & nie\nOK",
    );
  });
  it("цитата предыдущего письма отрезается", () => {
    const text =
      "Super, bierzemy pakiet Premium!\n\nW dniu 12.06.2027 o 10:00 Barowo <kontakt@barowo.com> napisał(a):\n> Dzień dobry";
    expect(stripQuote(text)).toBe("Super, bierzemy pakiet Premium!");
    expect(stripQuote("> tylko cytat")).toBe("> tylko cytat");
  });
  it("Re: не копится", () => {
    expect(replySubject("Re: RE: Odp: Oferta")).toBe("Re: Oferta");
    expect(replySubject("Oferta")).toBe("Re: Oferta");
  });
  it("событие email.received из документации Resend", () => {
    const ok = receivedEvent.safeParse({
      type: "email.received",
      created_at: "2026-02-22T23:41:12.126Z",
      data: {
        email_id: "56761188-7520-42d8-8898-ff6fc54ce618",
        from: "onboarding@resend.dev",
        to: ["delivered@resend.dev"],
        subject: "Sending this example",
        message_id: "<111-222-333@email.example.com>",
        attachments: [{ id: "a1", filename: "avatar.png", content_type: "image/png" }],
      },
    });
    expect(ok.success).toBe(true);
  });
});
