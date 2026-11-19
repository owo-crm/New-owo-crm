"use server";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { withOrg } from "@/lib/db/user";
import { requireOrganization } from "@/lib/auth/session";
import { t } from "@/lib/i18n";
import { renderLetter } from "@/lib/mailing/render";
import { loadLetterLook } from "./look";
import { findLeadByEmail, recordOutgoing } from "./inbox";
import { replySubject } from "./inbound";
import { encryptSecret, mailKeyStatus } from "./secret";
import { sendBusinessMail } from "./service";
import { MailError } from "./transport";

export type InboxResult = { ok?: true; error?: string };

async function origin() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

const replyInput = z.object({
  to: z.string().trim().toLowerCase().pipe(z.email()),
  text: z.string().max(20000).default(""),
  templateId: z.uuid().optional(),
});

/**
 * Ответ клиенту из переписки: свободный текст или шаблон. Оформление — как у всех писем
 * фирмы (тема, цвет, логотип, подпись), без ссылки отписки: это личная переписка, не рассылка.
 */
export async function sendReplyAction(raw: unknown): Promise<InboxResult> {
  const parsed = replyInput.safeParse(raw);
  if (!parsed.success) return { error: t("inbox.invalid") };
  const { to, text, templateId } = parsed.data;
  if (!templateId && !text.trim()) return { error: t("inbox.empty") };
  const { user, organization } = await requireOrganization();
  const db = getDb();

  // Шаблон и последнее письмо клиента читаем под RLS: только своей фирмы.
  const { template, last } = await withOrg(async (tx, { organization: org }) => {
    const template = templateId
      ? (
          await tx.query<{
            subject: string;
            body: string;
            heading1: string | null;
            heading2: string | null;
            button_text: string | null;
            button_url: string | null;
          }>(
            `select subject, body, heading1, heading2, button_text, button_url
               from public.mailing_templates where organization_id = $1 and id = $2`,
            [org.id, templateId],
          )
        ).rows[0]
      : undefined;
    const last = (
      await tx.query<{ subject: string; message_id: string | null }>(
        `select subject, message_id from public.mail_messages
          where organization_id = $1 and counterpart = $2
          order by created_at desc limit 1`,
        [org.id, to],
      )
    ).rows[0];
    return { template, last };
  });
  if (templateId && !template) return { error: t("inbox.invalid") };

  const leadId = await findLeadByEmail(db, organization.id, to);
  const leadName = leadId
    ? ((
        await db.query<{ client_name: string }>(
          "select client_name from public.leads where organization_id=$1 and id=$2",
          [organization.id, leadId],
        )
      ).rows[0]?.client_name ?? "")
    : "";
  const site = await origin();
  const letter = renderLetter(
    template
      ? {
          subject: template.subject,
          body: template.body,
          heading1: template.heading1,
          heading2: template.heading2,
          buttonText: template.button_text,
          buttonUrl: template.button_url,
        }
      : {
          subject: last
            ? replySubject(last.subject)
            : t("inbox.defaultSubject", { firm: organization.name }),
          body: text,
        },
    { name: leadName, email: to },
    {
      organizationId: organization.id,
      origin: site,
      brand: organization.name,
      look: await loadLetterLook(db, organization.id, site),
      unsubscribe: false,
    },
  );
  const inReplyTo = last?.message_id ?? null;
  try {
    await sendBusinessMail(
      db,
      organization.id,
      { to: [to], subject: letter.subject, html: letter.html, text: letter.text, inReplyTo },
      { kind: "reply", leadId, sentBy: user.id },
    );
  } catch (error) {
    const code = error instanceof MailError ? error.code : "send_failed";
    return { error: t(`mail.errors.${code}` as "mail.errors.send_failed") };
  }
  await recordOutgoing(db, {
    organizationId: organization.id,
    leadId,
    to,
    subject: letter.subject,
    // В чате показываем то, что человек написал (или текст шаблона), без технической обвязки.
    text: template
      ? [template.heading1, template.heading2, template.body]
          .filter(Boolean)
          .join("\n\n")
          .replace(/\{imie\}/g, leadName.split(/\s+/)[0] ?? "")
      : text,
    html: letter.html,
    inReplyTo,
    sentBy: user.id,
  });
  revalidatePath("/poczta");
  return { ok: true };
}

/** Секрет подписи вебхука Resend (whsec_…). Только owner/admin; хранится зашифрованным. */
export async function saveInboundSecretAction(
  _prev: InboxResult,
  form: FormData,
): Promise<InboxResult> {
  const secret = String(form.get("secret") ?? "").trim();
  if (!/^whsec_[A-Za-z0-9+/=]{16,}$/.test(secret)) return { error: t("inbox.badSecret") };
  if (mailKeyStatus() !== "ok") return { error: t("mail.errors.secret_key_missing") };
  try {
    await withOrg(async (tx, { organization, user }) => {
      if (!["owner", "admin"].includes(organization.role)) throw new Error("forbidden");
      await tx.query(
        "insert into public.organization_mail_settings (organization_id, updated_by) values ($1, $2) on conflict (organization_id) do nothing",
        [organization.id, user.id],
      );
      await tx.query(
        "update public.organization_mail_settings set inbound_secret_ciphertext = $2 where organization_id = $1",
        [organization.id, encryptSecret(secret)],
      );
    });
  } catch (error) {
    if ((error as Error).message === "forbidden") return { error: t("mail.forbidden") };
    return { error: t("common.unknownError") };
  }
  revalidatePath("/ustawienia/poczta");
  return { ok: true };
}

const lookInput = z.object({
  theme: z.enum(["light", "dark"]),
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  signature: z.string().max(500),
});

/** Внешний вид писем фирмы. */
export async function saveLetterLookAction(
  _prev: InboxResult,
  form: FormData,
): Promise<InboxResult> {
  const parsed = lookInput.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: t("mail.invalid") };
  try {
    await withOrg(async (tx, { organization, user }) => {
      if (!["owner", "admin"].includes(organization.role)) throw new Error("forbidden");
      await tx.query(
        "insert into public.organization_mail_settings (organization_id, updated_by) values ($1, $2) on conflict (organization_id) do nothing",
        [organization.id, user.id],
      );
      await tx.query(
        `update public.organization_mail_settings
            set letter_theme = $2, letter_accent = $3, letter_signature = $4
          where organization_id = $1`,
        [organization.id, parsed.data.theme, parsed.data.accent, parsed.data.signature.trim()],
      );
    });
  } catch (error) {
    if ((error as Error).message === "forbidden") return { error: t("mail.forbidden") };
    return { error: t("common.unknownError") };
  }
  revalidatePath("/ustawienia/poczta");
  revalidatePath("/poczta");
  return { ok: true };
}

/** Предпросмотр письма с текущими (ещё не сохранёнными) настройками вида. */
export async function previewLookAction(raw: unknown): Promise<{ html?: string }> {
  const parsed = lookInput.safeParse(raw);
  if (!parsed.success) return {};
  const { organization } = await requireOrganization();
  const site = await origin();
  const saved = await loadLetterLook(getDb(), organization.id, site);
  const letter = renderLetter(
    {
      subject: "Podgląd",
      heading1: "Wolne terminy",
      heading2: "na sezon 2027",
      body: "Cześć {imie},\n\ndziękujemy za zapytanie. Przygotowaliśmy dla Ciebie ofertę z trzema pakietami — zobacz, który pasuje najlepiej.",
      buttonText: "Zobacz ofertę",
      buttonUrl: "https://example.com",
    },
    { name: "Anna", email: "anna@example.com" },
    {
      organizationId: organization.id,
      origin: site,
      brand: organization.name,
      look: { ...saved, ...parsed.data },
      unsubscribe: true,
    },
  );
  return { html: letter.html };
}
