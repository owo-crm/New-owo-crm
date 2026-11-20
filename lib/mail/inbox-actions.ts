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
import { encryptSecret, mailKeyStatus } from "./secret";

export type InboxResult = { ok?: true; error?: string };

async function origin() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
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

const templateEdit = z.object({
  id: z.uuid(),
  subject: z.string().trim().min(1).max(200),
  body: z.string().max(8000),
  heading1: z.string().trim().max(60),
  heading2: z.string().trim().max(60),
  buttonText: z.string().trim().max(60),
  buttonUrl: z
    .string()
    .trim()
    .max(500)
    .refine((v) => !v || /^(https?:|mailto:|tel:)/i.test(v)),
  quickLabel: z.string().trim().max(40),
  quickPosition: z.coerce.number().int().min(0).max(999),
  stageAfter: z
    .string()
    .trim()
    .regex(/^([a-z][a-z0-9_]{0,49})?$/),
});

/**
 * «Ustawienia → Poczta → Szablony» (решение 053): текст письма, кнопка в «Szybkie działania»,
 * этап после отправки. Что прикладывать (document_kind/params) задаёт OWO импортом — не здесь.
 * Документные шаблоны правят только owner/admin (RLS); этап — только из воронки фирмы.
 */
export async function saveTemplateSettingsAction(
  _prev: InboxResult,
  form: FormData,
): Promise<InboxResult> {
  const parsed = templateEdit.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: t("chatDocs.errors.invalid") };
  const d = parsed.data;
  try {
    await withOrg(async (tx, { organization }) => {
      const row = (
        await tx.query<{ purpose: string }>(
          "select purpose from public.mailing_templates where organization_id=$1 and id=$2",
          [organization.id, d.id],
        )
      ).rows[0];
      if (!row) throw new Error("not_found");
      if (row.purpose === "document" && !["owner", "admin"].includes(organization.role))
        throw new Error("forbidden");
      if (d.stageAfter) {
        const stage = (
          await tx.query(
            "select 1 from public.pipeline_stages where organization_id=$1 and key=$2",
            [organization.id, d.stageAfter],
          )
        ).rows[0];
        if (!stage || row.purpose !== "document") throw new Error("bad_stage");
      }
      await tx.query(
        `update public.mailing_templates
            set subject=$3, body=$4, heading1=nullif($5,''), heading2=nullif($6,''),
                button_text=nullif($7,''), button_url=nullif($8,''),
                quick_label=nullif($9,''), quick_position=$10,
                stage_after=case when purpose='document' then nullif($11,'') else null end
          where organization_id=$1 and id=$2`,
        [
          organization.id,
          d.id,
          d.subject,
          d.body,
          d.heading1,
          d.heading2,
          d.buttonText,
          d.buttonUrl,
          d.quickLabel,
          d.quickPosition,
          d.stageAfter,
        ],
      );
    });
  } catch (error) {
    if ((error as Error).message === "forbidden") return { error: t("chatDocs.forbidden") };
    return { error: t("chatDocs.errors.invalid") };
  }
  revalidatePath("/ustawienia/poczta");
  return { ok: true };
}

/**
 * «Dodaj zestaw startowy» (решение 053): стартовые шаблоны документов Barowo — только для
 * фирмы с генератором Barowo, только owner/admin, по нажатию (не автоматически). Тот же импорт,
 * что и в скрипте: существующие шаблоны с тем же именем не трогаются.
 */
export async function installStarterTemplatesAction(
  _prev: InboxResult,
  _form: FormData,
): Promise<InboxResult> {
  const { organization } = await requireOrganization();
  if (!["owner", "admin"].includes(organization.role)) return { error: t("chatDocs.forbidden") };
  if (organization.documentEngine !== "barowo")
    return { error: t("chatDocs.errors.engine_missing") };
  const { importFile, applyImport } = await import("@/lib/mailing/import-templates");
  const starter = (await import("@/templates/barowo.json")).default;
  try {
    await applyImport(getDb(), organization.id, importFile.parse(starter).templates, {
      engine: organization.documentEngine,
    });
  } catch (error) {
    console.error("[templates] starter", (error as Error).message);
    return { error: t("chatDocs.starterFailed") };
  }
  revalidatePath("/ustawienia/poczta");
  revalidatePath("/leady", "layout");
  return { ok: true };
}
