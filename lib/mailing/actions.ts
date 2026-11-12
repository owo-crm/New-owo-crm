"use server";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { requireOrganization } from "@/lib/auth/session";
import { sendBusinessMail } from "@/lib/mail/service";
import { MailError } from "@/lib/mail/transport";
import { t } from "@/lib/i18n";
import { renderLetter } from "./render";
import { saveTemplate, startCampaign } from "./repository";

/** Действия панели рассылок. Ничего не уходит клиентам без явного нажатия. */

export type MailingResult = { ok?: true; error?: string; html?: string; id?: string; total?: number };

const letterSchema = z.object({
  subject: z.string().trim().min(1).max(200),
  body: z.string().max(8000),
  heading1: z.string().trim().max(60).nullable(),
  heading2: z.string().trim().max(60).nullable(),
  buttonText: z.string().trim().max(60).nullable(),
  buttonUrl: z.string().trim().max(500).nullable(),
});

async function origin() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

function mailError(error: unknown) {
  const code = error instanceof MailError ? error.code : "send_failed";
  return { error: t(`mail.errors.${code}` as "mail.errors.send_failed") };
}

/** Предпросмотр письма — то же, что увидит получатель, включая ссылку отписки. */
export async function previewLetterAction(raw: unknown, name: string): Promise<MailingResult> {
  const parsed = letterSchema.safeParse(raw);
  if (!parsed.success) return { error: t("mailing.invalid") };
  const { organization } = await requireOrganization();
  const letter = renderLetter(
    parsed.data,
    { name: name || "Anna", email: "podglad@example.com" },
    {
      organizationId: organization.id,
      origin: await origin(),
      brand: organization.name,
      brandColor: organization.brandColor,
    },
  );
  return { ok: true, html: letter.html };
}

/** Тестовое письмо себе: единственный способ увидеть вёрстку в настоящей почте. */
export async function sendTestAction(raw: unknown): Promise<MailingResult> {
  const parsed = letterSchema.safeParse(raw);
  if (!parsed.success) return { error: t("mailing.invalid") };
  const { user, organization } = await requireOrganization();
  if (!user.email.includes("@")) return { error: t("mailing.noOwnEmail") };
  const letter = renderLetter(
    parsed.data,
    { name: user.fullName, email: user.email },
    {
      organizationId: organization.id,
      origin: await origin(),
      brand: organization.name,
      brandColor: organization.brandColor,
    },
  );
  try {
    await sendBusinessMail(
      getDb(),
      organization.id,
      { to: [user.email], subject: `[TEST] ${letter.subject}`, html: letter.html, text: letter.text },
      { kind: "test", sentBy: user.id },
    );
    return { ok: true };
  } catch (error) {
    return mailError(error);
  }
}

export async function startCampaignAction(raw: unknown, leadIds: unknown): Promise<MailingResult> {
  const letter = letterSchema.safeParse(raw);
  const ids = z.array(z.uuid()).min(1).max(5000).safeParse(leadIds);
  if (!letter.success || !ids.success) return { error: t("mailing.invalid") };
  const { id, total } = await startCampaign(letter.data, ids.data);
  revalidatePath("/poczta");
  return { ok: true, id, total };
}

export async function saveTemplateAction(raw: unknown): Promise<MailingResult> {
  const parsed = letterSchema
    .extend({ id: z.uuid().optional(), name: z.string().trim().min(1).max(120) })
    .safeParse(raw);
  if (!parsed.success) return { error: t("mailing.invalid") };
  await saveTemplate(parsed.data);
  revalidatePath("/poczta");
  return { ok: true };
}
