import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { decryptSecret, encryptSecret, MailSecretKeyMissing } from "@/lib/mail/secret";
import {
  classifySmtpError,
  deliverMail,
  MailError,
  validateMail,
  type MailSettings,
  type SmtpFactory,
} from "@/lib/mail/transport";

const KEY = randomBytes(32).toString("base64");

describe("szyfrowanie hasła poczty", () => {
  it("szyfruje i odszyfrowuje; szyfrogram nie zawiera hasła", () => {
    const stored = encryptSecret("abcd efgh ijkl mnop", KEY);
    expect(stored.startsWith("v1:")).toBe(true);
    expect(stored).not.toContain("abcd");
    expect(decryptSecret(stored, KEY)).toBe("abcd efgh ijkl mnop");
    expect(encryptSecret("x", KEY)).not.toBe(encryptSecret("x", KEY)); // losowy IV
  });
  it("inny klucz albo zmieniony szyfrogram — błąd, nie śmieci", () => {
    const stored = encryptSecret("tajne", KEY);
    expect(() => decryptSecret(stored, randomBytes(32).toString("base64"))).toThrow();
    const tampered = stored.slice(0, -2) + (stored.endsWith("A") ? "BB" : "AA");
    expect(() => decryptSecret(tampered, KEY)).toThrow();
  });
  it("bez MAIL_SECRET_KEY — jasny błąd", () => {
    const saved = process.env.MAIL_SECRET_KEY;
    delete process.env.MAIL_SECRET_KEY;
    expect(() => encryptSecret("x")).toThrow(MailSecretKeyMissing);
    if (saved) process.env.MAIL_SECRET_KEY = saved;
  });
});

const gmail: MailSettings = {
  transport: "smtp",
  fromName: "Barowo",
  fromEmail: "barowo.pl@gmail.com",
  replyTo: null,
  smtpHost: "smtp.gmail.com",
  smtpPort: 587,
  smtpUser: "barowo.pl@gmail.com",
  secret: "apppassword",
};

describe("wysyłka SMTP", () => {
  it("Gmail 587: STARTTLS wymagany, bez dostępu do plików i URL, nadawca z nazwą", async () => {
    const sendMail = vi.fn().mockResolvedValue({});
    const smtp = vi.fn<SmtpFactory>(() => ({ sendMail }));
    await deliverMail(
      gmail,
      {
        to: ["Klient@Example.com"],
        subject: "Oferta\r\nBcc: zly@example.com",
        text: "Dzień dobry",
        attachments: [{ filename: "oferta.pdf", content: Buffer.from("%PDF") }],
      },
      { smtp },
    );
    const options = smtp.mock.calls[0][0];
    expect(options).toMatchObject({
      host: "smtp.gmail.com",
      port: 587,
      secure: false,
      requireTLS: true,
      disableFileAccess: true,
      disableUrlAccess: true,
      auth: { user: "barowo.pl@gmail.com", pass: "apppassword" },
    });
    const message = sendMail.mock.calls[0][0] as Record<string, unknown>;
    expect(message.from).toBe('"Barowo" <barowo.pl@gmail.com>');
    expect(message.to).toEqual(["klient@example.com"]);
    expect(message.subject).toBe("Oferta Bcc: zly@example.com"); // без перевода строки — без инъекции
  });

  it("port 465 — od razu TLS", async () => {
    const smtp = vi.fn<SmtpFactory>(() => ({ sendMail: vi.fn().mockResolvedValue({}) }));
    await deliverMail(
      { ...gmail, smtpPort: 465 },
      { to: ["a@b.pl"], subject: "s", text: "t" },
      { smtp },
    );
    expect(smtp.mock.calls[0][0]).toMatchObject({ secure: true, requireTLS: false });
  });

  it.each([
    [
      {
        code: "EAUTH",
        responseCode: 535,
        response: "535-5.7.8 Username and Password not accepted",
      },
      "auth_failed",
    ],
    [
      { responseCode: 550, response: "550 5.4.5 Daily user sending limit exceeded" },
      "quota_exceeded",
    ],
    [{ code: "ETIMEDOUT", message: "Connection timeout" }, "connection_failed"],
    [
      {
        responseCode: 552,
        response: "552 5.3.4 Your message exceeded Google's message size limits",
      },
      "attachment_too_large",
    ],
    [
      { code: "EENVELOPE", response: "550 5.1.1 The email account does not exist" },
      "recipient_rejected",
    ],
    [{ message: "weird" }, "send_failed"],
  ])("błąd SMTP %o → %s (z prawdziwym tekstem serwera)", (error, code) => {
    const mapped = classifySmtpError(error);
    expect(mapped.code).toBe(code);
    expect(mapped.detail).toBeTruthy();
  });

  it("limity Gmaila: maks. 100 odbiorców, 25 MB załączników, poprawne adresy", () => {
    const many = Array.from({ length: 101 }, (_, i) => `k${i}@example.com`);
    expect(() => validateMail({ to: many, subject: "s", text: "t" })).toThrow(
      "too_many_recipients",
    );
    expect(() =>
      validateMail({
        to: ["a@b.pl"],
        subject: "s",
        text: "t",
        attachments: [{ filename: "big.pdf", content: Buffer.alloc(25 * 1024 * 1024 + 1) }],
      }),
    ).toThrow("attachment_too_large");
    expect(() => validateMail({ to: ["nie-adres"], subject: "s", text: "t" })).toThrow(
      "recipient_rejected",
    );
    expect(() => validateMail({ to: [" "], subject: "s", text: "t" })).toThrow("no_recipients");
  });

  it("poczta wyłączona albo bez hasła — not_configured, nic nie wysyłamy", async () => {
    const smtp = vi.fn();
    await expect(
      deliverMail(
        { ...gmail, transport: "none" },
        { to: ["a@b.pl"], subject: "s", text: "t" },
        { smtp },
      ),
    ).rejects.toMatchObject({ code: "not_configured" });
    await expect(
      deliverMail(
        { ...gmail, secret: null },
        { to: ["a@b.pl"], subject: "s", text: "t" },
        { smtp },
      ),
    ).rejects.toBeInstanceOf(MailError);
    expect(smtp).not.toHaveBeenCalled();
  });
});

describe("wysyłka Resend (firmy z własną domeną)", () => {
  const resend: MailSettings = {
    ...gmail,
    transport: "resend",
    fromEmail: "biuro@firma.pl",
    smtpHost: null,
  };
  it("wysyła z kluczem firmy i załącznikiem base64", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    await deliverMail(
      resend,
      {
        to: ["a@b.pl"],
        subject: "s",
        text: "t",
        attachments: [{ filename: "o.pdf", content: Buffer.from("PDF") }],
      },
      { fetch },
    );
    const [, init] = fetch.mock.calls[0];
    expect(init.headers.Authorization).toBe("Bearer apppassword");
    const body = JSON.parse(init.body);
    expect(body.from).toBe('"Barowo" <biuro@firma.pl>');
    expect(body.attachments[0].content).toBe(Buffer.from("PDF").toString("base64"));
  });
  it.each([
    [401, "auth_failed"],
    [429, "quota_exceeded"],
    [422, "recipient_rejected"],
    [500, "send_failed"],
  ])("HTTP %s → %s", async (status, code) => {
    const fetch = vi.fn().mockResolvedValue(new Response("err", { status }));
    await expect(
      deliverMail(resend, { to: ["a@b.pl"], subject: "s", text: "t" }, { fetch }),
    ).rejects.toMatchObject({ code });
  });
});

describe("klucz MAIL_SECRET_KEY: tolerancja na kopiowanie i jasna diagnoza", () => {
  it("base64 z cudzysłowami/spacjami/nową linią, base64url i hex są poprawne", async () => {
    const { mailKeyStatus, parseMailKey } = await import("@/lib/mail/secret");
    const b64 = randomBytes(32).toString("base64");
    expect(mailKeyStatus(` "${b64}"\n`)).toBe("ok");
    expect(mailKeyStatus(randomBytes(32).toString("base64url"))).toBe("ok");
    expect(mailKeyStatus(randomBytes(32).toString("hex"))).toBe("ok");
    expect(parseMailKey(`'${b64}'`)?.equals(Buffer.from(b64, "base64"))).toBe(true);
  });
  it("puste → missing, zła długość albo znaki → invalid", async () => {
    const { mailKeyStatus } = await import("@/lib/mail/secret");
    expect(mailKeyStatus(undefined)).toBe("missing");
    expect(mailKeyStatus("   ")).toBe("missing");
    expect(mailKeyStatus(randomBytes(16).toString("base64"))).toBe("invalid");
    expect(mailKeyStatus("moje-tajne-haslo!")).toBe("invalid");
  });
});
