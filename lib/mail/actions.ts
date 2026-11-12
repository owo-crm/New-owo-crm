"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { withOrg } from "@/lib/db/user";
import { t, type MessageKey } from "@/lib/i18n";
import { encryptSecret, isMailSecretKeyConfigured } from "./secret";
import { sendBusinessMail } from "./service";
import { MailError } from "./transport";

export type MailFormState = { error?: string; ok?: string; detail?: string };

const email = z.string().trim().toLowerCase().max(254).pipe(z.email());
const optionalEmail = z
  .string()
  .trim()
  .transform((v) => v || null)
  .pipe(email.nullable());

const schema = z.discriminatedUnion("transport", [
  z.object({ transport: z.literal("none") }),
  z.object({
    transport: z.literal("smtp"),
    fromName: z.string().trim().max(120),
    replyTo: optionalEmail,
    smtpHost: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9.-]{1,253}$/),
    smtpPort: z.coerce
      .number()
      .int()
      .pipe(z.union([z.literal(465), z.literal(587), z.literal(2525), z.literal(25)])),
    smtpUser: email,
    secret: z.string().max(500),
    dailyLimit: z.coerce.number().int().min(1).max(2000),
  }),
  z.object({
    transport: z.literal("resend"),
    fromName: z.string().trim().max(120),
    fromEmail: email,
    replyTo: optionalEmail,
    secret: z.string().max(500),
    dailyLimit: z.coerce.number().int().min(1).max(2000),
  }),
]);

/** Сообщение пользователю по коду ошибки почты. */
function mailMessage(code: string): string {
  const key = `mail.errors.${code}` as MessageKey;
  const text = t(key);
  return text === key ? t("mail.errors.send_failed") : text;
}

/** Сохранить настройки почты фирмы. Только owner/admin (и RLS). Секрет — только зашифрованным. */
export async function saveMailSettings(
  _prev: MailFormState,
  form: FormData,
): Promise<MailFormState> {
  const raw = Object.fromEntries(form);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { error: t("mail.invalid") };
  const data = parsed.data;
  // Пробелы из пароля приложения Google («abcd efgh ijkl mnop») убираем — Gmail их не ждёт.
  const secretPlain = data.transport === "none" ? "" : data.secret.replace(/\s+/g, "");
  if (secretPlain && !isMailSecretKeyConfigured())
    return { error: t("mail.errors.secret_key_missing") };
  try {
    await withOrg(async (tx, { organization, user }) => {
      if (!["owner", "admin"].includes(organization.role)) throw new Error("forbidden");
      await tx.query(
        "insert into public.organization_mail_settings (organization_id, updated_by) values ($1, $2) on conflict (organization_id) do nothing",
        [organization.id, user.id],
      );
      if (data.transport === "none") {
        await tx.query(
          "update public.organization_mail_settings set transport='none', updated_by=$2 where organization_id=$1",
          [organization.id, user.id],
        );
        return;
      }
      const isSet = (
        await tx.query<{ set: boolean }>("select public.mail_secret_is_set($1) as set", [
          organization.id,
        ])
      ).rows[0]?.set;
      if (!secretPlain && !isSet) throw new Error("secret_required");
      const common = [
        organization.id,
        user.id,
        data.transport,
        data.fromName || null,
        data.transport === "smtp" ? data.smtpUser : data.fromEmail,
        data.replyTo,
        data.dailyLimit,
      ];
      await tx.query(
        `update public.organization_mail_settings
            set transport=$3, from_name=$4, from_email=$5, reply_to=$6, daily_limit=$7, updated_by=$2,
                smtp_host=$8, smtp_port=$9, smtp_user=$10,
                last_test_at=null, last_test_ok=null, last_test_error=null
          where organization_id=$1`,
        [
          ...common,
          data.transport === "smtp" ? data.smtpHost : null,
          data.transport === "smtp" ? data.smtpPort : null,
          data.transport === "smtp" ? data.smtpUser : null,
        ],
      );
      if (secretPlain)
        await tx.query(
          "update public.organization_mail_settings set secret_ciphertext=$2 where organization_id=$1",
          [organization.id, encryptSecret(secretPlain)],
        );
    });
  } catch (error) {
    const message = (error as Error).message;
    if (message === "forbidden") return { error: t("mail.forbidden") };
    if (message === "secret_required") return { error: t("mail.secretRequired") };
    console.error("[mail] save", message);
    return { error: t("common.unknownError") };
  }
  revalidatePath("/ustawienia/poczta");
  return { ok: t("mail.saved") };
}

/** Тестовое письмо на адрес вошедшего пользователя. Показывает настоящую причину ошибки. */
export async function sendTestMail(_prev: MailFormState): Promise<MailFormState> {
  const ctx = await withOrg(async (_tx, { organization, user }) => ({ organization, user }));
  if (!["owner", "admin"].includes(ctx.organization.role)) return { error: t("mail.forbidden") };
  const db = getDb();
  let state: MailFormState;
  try {
    await sendBusinessMail(
      db,
      ctx.organization.id,
      {
        to: [ctx.user.email],
        subject: t("mail.testSubject", { firm: ctx.organization.name }),
        text: t("mail.testBody"),
      },
      { kind: "test", sentBy: ctx.user.id },
    );
    state = { ok: t("mail.testSent", { email: ctx.user.email }) };
  } catch (error) {
    const e = error instanceof MailError ? error : new MailError("send_failed");
    state = { error: mailMessage(e.code), detail: e.detail };
  }
  await db.query(
    "update public.organization_mail_settings set last_test_at=now(), last_test_ok=$2, last_test_error=$3 where organization_id=$1",
    [
      ctx.organization.id,
      !state.error,
      state.error ? `${state.error}${state.detail ? ` (${state.detail})` : ""}` : null,
    ],
  );
  revalidatePath("/ustawienia/poczta");
  return state;
}
