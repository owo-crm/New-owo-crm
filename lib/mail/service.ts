import { one, type Queryable } from "../db/core.ts";
import { decryptSecret, MailSecretKeyMissing } from "./secret.ts";
import {
  deliverMail,
  MailError,
  validateMail,
  type MailSettings,
  type OutgoingMail,
  type SmtpFactory,
} from "./transport.ts";

/**
 * Письма от имени фирмы: настройки из базы, дневной лимит по журналу, запись в журнал.
 * Вызывать ТОЛЬКО с соединением владельца базы (asService/getDb) и organizationId,
 * который уже проверен через withOrg — секрет читается в обход RLS.
 */
export type MailKind =
  "test" | "document" | "auto_offer" | "follow_up" | "review" | "mailing" | "notification";

type Row = {
  transport: MailSettings["transport"];
  from_name: string | null;
  from_email: string | null;
  reply_to: string | null;
  smtp_host: string | null;
  smtp_port: number | null;
  smtp_user: string | null;
  secret_ciphertext: string | null;
  daily_limit: number;
};

export async function loadMailSettings(db: Queryable, organizationId: string) {
  const row = await one<Row>(
    db,
    `select transport, from_name, from_email, reply_to, smtp_host, smtp_port, smtp_user,
            secret_ciphertext, daily_limit
       from public.organization_mail_settings where organization_id = $1`,
    [organizationId],
  );
  if (!row || row.transport === "none") return null;
  let secret: string | null = null;
  if (row.secret_ciphertext) {
    try {
      secret = decryptSecret(row.secret_ciphertext);
    } catch (error) {
      if (error instanceof MailSecretKeyMissing) throw new MailError("secret_key_missing");
      throw new MailError("not_configured", "secret_unreadable");
    }
  }
  const settings: MailSettings = {
    transport: row.transport,
    fromName: row.from_name,
    fromEmail: row.from_email,
    replyTo: row.reply_to,
    smtpHost: row.smtp_host,
    smtpPort: row.smtp_port,
    smtpUser: row.smtp_user,
    secret,
  };
  return { settings, dailyLimit: row.daily_limit };
}

/** Сколько получателей уже ушло сегодня (сутки по Варшаве). */
export async function recipientsSentToday(db: Queryable, organizationId: string) {
  const row = await one<{ n: number }>(
    db,
    `select coalesce(sum(recipients), 0)::int as n from public.mail_send_log
      where organization_id = $1 and ok
        and created_at >= (date_trunc('day', now() at time zone 'Europe/Warsaw') at time zone 'Europe/Warsaw')`,
    [organizationId],
  );
  return row?.n ?? 0;
}

export async function sendBusinessMail(
  db: Queryable,
  organizationId: string,
  mail: OutgoingMail,
  meta: { kind: MailKind; leadId?: string | null; sentBy?: string | null },
  deps: { smtp?: SmtpFactory; fetch?: typeof fetch } = {},
) {
  const loaded = await loadMailSettings(db, organizationId);
  if (!loaded) throw new MailError("not_configured");
  const checked = validateMail(mail);
  const sent = await recipientsSentToday(db, organizationId);
  if (sent + checked.to.length > loaded.dailyLimit)
    throw new MailError("daily_limit", `${sent}/${loaded.dailyLimit}`);
  try {
    await deliverMail(loaded.settings, checked, deps);
  } catch (error) {
    const mailError = error instanceof MailError ? error : new MailError("send_failed");
    await log(db, organizationId, checked.to.length, false, mailError.code, meta);
    throw mailError;
  }
  await log(db, organizationId, checked.to.length, true, null, meta);
  return {
    recipients: checked.to.length,
    sentToday: sent + checked.to.length,
    limit: loaded.dailyLimit,
  };
}

async function log(
  db: Queryable,
  organizationId: string,
  recipients: number,
  ok: boolean,
  error: string | null,
  meta: { kind: MailKind; leadId?: string | null; sentBy?: string | null },
) {
  await db.query(
    `insert into public.mail_send_log (organization_id, kind, recipients, ok, error, lead_id, sent_by)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [organizationId, meta.kind, recipients, ok, error, meta.leadId ?? null, meta.sentBy ?? null],
  );
}
