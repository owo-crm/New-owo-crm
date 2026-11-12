import nodemailer from "nodemailer";

/**
 * Отправка писем от имени фирмы (решение 035). Чистая логика без базы — тестируется с подменённым
 * транспортом. Настройки и журнал — в lib/mail/service.ts.
 */
export type MailTransportKind = "none" | "smtp" | "resend";

export type MailSettings = {
  transport: MailTransportKind;
  fromName: string | null;
  fromEmail: string | null;
  replyTo: string | null;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpUser: string | null;
  /** Расшифрованный пароль SMTP или ключ Resend. */
  secret: string | null;
};

export type MailAttachment = { filename: string; content: Buffer; contentType?: string };

export type OutgoingMail = {
  to: string[];
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
  attachments?: MailAttachment[];
};

export type MailErrorCode =
  | "not_configured"
  | "secret_key_missing"
  | "too_many_recipients"
  | "no_recipients"
  | "daily_limit"
  | "auth_failed"
  | "quota_exceeded"
  | "connection_failed"
  | "attachment_too_large"
  | "recipient_rejected"
  | "send_failed";

export class MailError extends Error {
  readonly code: MailErrorCode;
  /** Текст сервера как есть — показываем при тестовом письме, чтобы было видно реальную причину. */
  readonly detail?: string;
  constructor(code: MailErrorCode, detail?: string) {
    super(code);
    this.code = code;
    this.detail = detail;
  }
}

/** Ограничения Gmail для обычного аккаунта: 100 получателей в письме, вложения до 25 МБ. */
export const MAX_RECIPIENTS = 100;
export const MAX_ATTACHMENTS_BYTES = 25 * 1024 * 1024;

type SmtpError = { code?: string; responseCode?: number; response?: string; message?: string };

/** Ошибка SMTP → понятный код. Gmail: 535 — неверный пароль приложения, 550 5.4.5 — дневной лимит. */
export function classifySmtpError(error: unknown): MailError {
  const e = (error ?? {}) as SmtpError;
  const detail = (e.response || e.message || "").slice(0, 300);
  const text = detail.toLowerCase();
  if (e.code === "EAUTH" || e.responseCode === 535 || e.responseCode === 534)
    return new MailError("auth_failed", detail);
  if (
    text.includes("5.4.5") ||
    text.includes("sending limit") ||
    text.includes("daily user sending") ||
    (e.responseCode === 421 && text.includes("4.7.0") && text.includes("limit"))
  )
    return new MailError("quota_exceeded", detail);
  if (e.responseCode === 552 || text.includes("size limit") || text.includes("too large"))
    return new MailError("attachment_too_large", detail);
  if (e.code === "EENVELOPE" || e.responseCode === 550 || e.responseCode === 553)
    return new MailError("recipient_rejected", detail);
  if (
    ["ECONNECTION", "ETIMEDOUT", "ESOCKET", "EDNS", "ECONNREFUSED", "ENOTFOUND"].includes(
      e.code ?? "",
    )
  )
    return new MailError("connection_failed", detail);
  return new MailError("send_failed", detail);
}

function fromHeader(settings: MailSettings) {
  const address = settings.fromEmail || settings.smtpUser;
  if (!address) throw new MailError("not_configured");
  const name = (settings.fromName ?? "").replace(/["\r\n]/g, "").trim();
  return name ? `"${name}" <${address}>` : address;
}

export function validateMail(mail: OutgoingMail) {
  const to = [...new Set(mail.to.map((a) => a.trim().toLowerCase()).filter(Boolean))];
  if (!to.length) throw new MailError("no_recipients");
  if (to.length > MAX_RECIPIENTS) throw new MailError("too_many_recipients");
  if (to.some((a) => !/^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]+$/.test(a)))
    throw new MailError("recipient_rejected");
  const size = (mail.attachments ?? []).reduce((n, a) => n + a.content.length, 0);
  if (size > MAX_ATTACHMENTS_BYTES) throw new MailError("attachment_too_large");
  return { ...mail, to, subject: mail.subject.replace(/[\r\n]+/g, " ").slice(0, 300) };
}

export type SmtpFactory = (options: Record<string, unknown>) => {
  sendMail(message: Record<string, unknown>): Promise<unknown>;
};

const realSmtp: SmtpFactory = (options) => nodemailer.createTransport(options as never);

/** Отправить одно письмо по настройкам фирмы. Бросает MailError. */
export async function deliverMail(
  settings: MailSettings,
  input: OutgoingMail,
  deps: { smtp?: SmtpFactory; fetch?: typeof fetch } = {},
): Promise<void> {
  if (settings.transport === "none") throw new MailError("not_configured");
  if (!settings.secret) throw new MailError("not_configured");
  const mail = validateMail(input);
  const replyTo = mail.replyTo || settings.replyTo || undefined;

  if (settings.transport === "smtp") {
    if (!settings.smtpHost || !settings.smtpPort || !settings.smtpUser)
      throw new MailError("not_configured");
    const transport = (deps.smtp ?? realSmtp)({
      host: settings.smtpHost,
      port: settings.smtpPort,
      secure: settings.smtpPort === 465, // 465 — сразу TLS; 587 — STARTTLS (обязателен)
      requireTLS: settings.smtpPort !== 465,
      auth: { user: settings.smtpUser, pass: settings.secret },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 30_000,
      disableFileAccess: true,
      disableUrlAccess: true,
    });
    try {
      await transport.sendMail({
        from: fromHeader(settings),
        to: mail.to,
        replyTo,
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
        attachments: mail.attachments?.map((a) => ({
          filename: a.filename,
          content: a.content,
          contentType: a.contentType,
        })),
      });
    } catch (error) {
      throw classifySmtpError(error);
    }
    return;
  }

  // Resend — для фирм со своим доменом (клиенты агентства).
  const request = deps.fetch ?? globalThis.fetch;
  let response: Response;
  try {
    response = await request("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${settings.secret}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: fromHeader(settings),
        to: mail.to,
        reply_to: replyTo,
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
        attachments: mail.attachments?.map((a) => ({
          filename: a.filename,
          content: a.content.toString("base64"),
        })),
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    throw new MailError("connection_failed", (error as Error).message);
  }
  if (response.ok) return;
  const detail = (await response.text().catch(() => "")).slice(0, 300);
  if (response.status === 401 || response.status === 403)
    throw new MailError("auth_failed", detail);
  if (response.status === 429) throw new MailError("quota_exceeded", detail);
  if (response.status === 422) throw new MailError("recipient_rejected", detail);
  throw new MailError("send_failed", detail);
}
