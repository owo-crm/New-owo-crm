import { describe, expect, it, vi } from "vitest";
import { resolveStageAfter } from "@/lib/documents/stage";
import { classifySmtpError, deliverMail, isPdf, safeFilename } from "@/lib/mail/transport";
import { quickActions } from "@/lib/mailing/quick";
import type { Template } from "@/lib/mailing/repository";

/** Решение 053: сдвиг этапа, «неопределённый» результат отправки, кнопки из шаблонов. */
const STAGES = [
  { key: "new", position: 0, kind: "open" },
  { key: "contacted", position: 1, kind: "open" },
  { key: "offer_sent", position: 2, kind: "open" },
  { key: "contract_sent", position: 4, kind: "open" },
  { key: "deposit_paid", position: 5, kind: "won" },
  { key: "spam", position: 7, kind: "lost" },
];

describe("resolveStageAfter", () => {
  it("только вперёд, по смыслу действия", () => {
    expect(resolveStageAfter({ stages: STAGES, current: "contacted", meaning: "offer_sent" })).toBe(
      "offer_sent",
    );
    expect(
      resolveStageAfter({ stages: STAGES, current: "contract_sent", meaning: "offer_sent" }),
    ).toBeNull();
    expect(
      resolveStageAfter({ stages: STAGES, current: "offer_sent", meaning: "contract_sent" }),
    ).toBe("contract_sent");
  });
  it("won/lost не трогаем; цели нет — null; явный этап шаблона важнее", () => {
    expect(
      resolveStageAfter({ stages: STAGES, current: "deposit_paid", meaning: "offer_sent" }),
    ).toBeNull();
    expect(
      resolveStageAfter({ stages: STAGES, current: "spam", meaning: "offer_sent" }),
    ).toBeNull();
    expect(
      resolveStageAfter({
        stages: STAGES.filter((s) => s.key !== "offer_sent"),
        current: "new",
        meaning: "offer_sent",
      }),
    ).toBeNull();
    expect(
      resolveStageAfter({
        stages: STAGES,
        current: "new",
        explicit: "contacted",
        meaning: "offer_sent",
      }),
    ).toBe("contacted");
    expect(resolveStageAfter({ stages: STAGES, current: "new", meaning: null })).toBeNull();
  });
  it("смысловые теги (D-14) работают без привязки к ключу", () => {
    const tagged = [
      { key: "a", position: 0, kind: "open" },
      { key: "wyslano", position: 3, kind: "open", tags: ["offer_sent"] },
    ];
    expect(resolveStageAfter({ stages: tagged, current: "a", meaning: "offer_sent" })).toBe(
      "wyslano",
    );
  });
});

describe("неопределённый результат отправки (D-20)", () => {
  it("SMTP: отказ в соединении — точно не ушло; обрыв посреди — могло уйти", () => {
    expect(classifySmtpError({ code: "ECONNREFUSED" }).uncertain).toBe(false);
    expect(classifySmtpError({ code: "ETIMEDOUT" }).uncertain).toBe(true);
    expect(classifySmtpError({ code: "EAUTH", responseCode: 535 }).uncertain).toBe(false);
  });

  const settings = {
    transport: "resend" as const,
    fromName: "Barowo",
    fromEmail: "kontakt@barowo.com",
    replyTo: null,
    smtpHost: null,
    smtpPort: null,
    smtpUser: null,
    secret: "re_x",
  };
  const mail = { to: ["a@b.pl"], subject: "s", text: "t", idempotencyKey: "op-1" };

  it("Resend: ключ операции уходит заголовком Idempotency-Key, id письма возвращается", async () => {
    const fetch = vi.fn(async () => Response.json({ id: "re_123" }));
    expect(await deliverMail(settings, mail, { fetch: fetch as never })).toEqual({
      providerId: "re_123",
    });
    expect((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].headers).toMatchObject({
      "Idempotency-Key": "op-1",
    });
  });

  it("Resend: таймаут — uncertain, отказ в соединении — нет", async () => {
    const timeout = vi.fn(async () => {
      throw new DOMException("aborted", "TimeoutError");
    });
    await expect(deliverMail(settings, mail, { fetch: timeout as never })).rejects.toMatchObject({
      uncertain: true,
    });
    const refused = vi.fn(async () => {
      throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
    });
    await expect(deliverMail(settings, mail, { fetch: refused as never })).rejects.toMatchObject({
      uncertain: false,
    });
  });
});

describe("вложения", () => {
  it("имя файла без путей и управляющих символов; PDF — по байтам", () => {
    const evil = safeFilename("../../etc/passwd");
    expect(evil).not.toMatch(/[\\/]/);
    expect(evil.startsWith(".")).toBe(false);
    expect(safeFilename('Oferta "Simple"\r\n.pdf')).toBe("Oferta _Simple_.pdf");
    expect(safeFilename("")).toBe("dokument.pdf");
    expect(isPdf(new TextEncoder().encode("%PDF-1.7"))).toBe(true);
    expect(isPdf(new TextEncoder().encode("<html>"))).toBe(false);
  });
});

describe("кнопки «Szybkie działania» из шаблонов", () => {
  const base = {
    subject: "s",
    body: "b",
    heading1: null,
    heading2: null,
    button_text: null,
    button_url: null,
    document_params: {},
    attachment_id: null,
    stage_after: null,
    quick_label: null,
    quick_position: 0,
    document_mode: null,
    document_kind: null,
    purpose: "mail",
  } as const;
  const t = (x: Partial<Template> & { id: string; name: string }) =>
    ({ ...base, ...x }) as Template;
  const templates = [
    t({
      id: "b",
      name: "Umowa",
      purpose: "document",
      document_kind: "contract",
      document_mode: "form",
      quick_label: "Umowa",
      quick_position: 50,
    }),
    t({
      id: "a",
      name: "Simple",
      purpose: "document",
      document_kind: "offer",
      document_mode: "quick",
      document_params: { package: "simple" },
      quick_label: "Simple",
      quick_position: 10,
    }),
    t({
      id: "c",
      name: "Cennik",
      purpose: "document",
      document_kind: "file",
      attachment_id: "f",
      quick_label: "Cennik",
      quick_position: 90,
    }),
    t({ id: "d", name: "Bez przycisku" }),
  ];

  it("порядок и ссылки задают шаблоны: быстрая — в чат, форма — на форму", () => {
    const actions = quickActions(templates, "L", {
      documentEngine: "barowo",
      modules: ["documents"],
    });
    expect(actions.map((a) => a.label)).toEqual(["Simple", "Umowa", "Cennik"]);
    expect(actions[0].href).toBe("/poczta?lead=L&tpl=a");
    expect(actions[1].href).toBe("/leady/L/umowa?tpl=b");
    expect(actions[2].href).toBe("/poczta?lead=L&tpl=c");
  });

  it("без генератора остаются только шаблоны с готовым файлом", () => {
    const actions = quickActions(templates, "L", { documentEngine: null, modules: [] });
    expect(actions.map((a) => a.label)).toEqual(["Cennik"]);
  });
});
