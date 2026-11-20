"use server";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { withOrg } from "@/lib/db/user";
import { requireOrganization } from "@/lib/auth/session";
import { t } from "@/lib/i18n";
import { PACKAGE_KEYS, type PackageKey } from "@/lib/documents/barowo/engine";
import {
  DocumentInputError,
  generateOffer,
  offerFormDefaults,
  previewOffer,
  suggestedOfferPrice,
} from "@/lib/documents/service";
import { loadLetterLook } from "./look";
import {
  chatSendInput,
  engineSupports,
  quickOfferValues,
  sendChatMessage,
  type ChatSendResult,
  type QuickOfferValues,
} from "./chat-send";

/** Действия чата «Poczta → Wiadomości» (решение 053). */

async function origin() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

const contactOf = (o: { email: string | null; phone: string | null }) =>
  [o.email, o.phone].filter(Boolean).join("  /  ");

export type ChatActionResult = ChatSendResult & { text?: string };

const ERROR_KEYS = new Set([
  "no_email",
  "lead_not_found",
  "template_not_found",
  "document_not_found",
  "document_needs_lead",
  "document_required",
  "values_required",
  "engine_missing",
  "file_not_found",
  "not_pdf",
  "empty",
  "operation_conflict",
]);

function describe(result: ChatSendResult): ChatActionResult {
  if (result.status !== "error") return result;
  if (result.message) return { ...result, text: result.message };
  const key = ERROR_KEYS.has(result.code)
    ? `chatDocs.errors.${result.code}`
    : `mail.errors.${result.code}`;
  const text = t(key as "mail.errors.send_failed");
  return { ...result, text: text === key ? t("mail.errors.send_failed") : text };
}

export async function sendChatAction(raw: unknown): Promise<ChatActionResult> {
  const parsed = chatSendInput.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      status: "error",
      code: "invalid",
      documentId: null,
      text:
        issue?.message && !issue.message.startsWith("Invalid") ? issue.message : t("inbox.invalid"),
    };
  }
  const { user, organization } = await requireOrganization();
  const site = await origin();
  const db = getDb();
  const result = await sendChatMessage(parsed.data, {
    db,
    runAsUser: (fn) => withOrg((tx) => fn(tx)),
    ctx: { userId: user.id, organization },
    origin: site,
    look: await loadLetterLook(db, organization.id, site),
    generateQuickOffer: async (tx, { leadId, pkg, values, operationKey }) => {
      const key = z.enum(PACKAGE_KEYS).parse(pkg);
      const defaults = await offerFormDefaults(tx, organization.id, leadId, key);
      return generateOffer(
        tx,
        { userId: user.id, orgId: organization.id, operationKey },
        leadId,
        key,
        { ...defaults, ...values, listPrice: "" },
        contactOf(organization),
      ).catch((error) => {
        if (error instanceof DocumentInputError) throw new Error(error.message);
        throw error;
      });
    },
  });
  revalidatePath("/poczta");
  if (parsed.data.leadId) revalidatePath(`/leady/${parsed.data.leadId}`);
  return describe(result);
}

/** Пакет быстрой оферты из параметров шаблона (только из базы, не из браузера). */
async function quickTemplate(templateId: string) {
  return withOrg(async (tx, { organization }) => {
    const row = (
      await tx.query<{
        document_kind: string | null;
        document_mode: string | null;
        document_params: Record<string, unknown>;
      }>(
        `select document_kind, document_mode, document_params from public.mailing_templates
          where organization_id=$1 and id=$2 and purpose='document'`,
        [organization.id, templateId],
      )
    ).rows[0];
    if (!row || row.document_kind !== "offer" || row.document_mode !== "quick") return null;
    const pkg = z.enum(PACKAGE_KEYS).safeParse(row.document_params.package);
    return pkg.success ? { pkg: pkg.data as PackageKey, organization } : null;
  });
}

/** Значения карточки документа в чате: из лида и каталога пакета. Лид не меняется. */
export async function quickOfferDefaultsAction(
  leadId: string,
  templateId: string,
  guests?: string,
): Promise<{ values?: QuickOfferValues; suggested?: string; pkgName?: string; error?: string }> {
  if (!z.uuid().safeParse(leadId).success || !z.uuid().safeParse(templateId).success)
    return { error: t("inbox.invalid") };
  const quick = await quickTemplate(templateId);
  if (!quick || !engineSupports(quick.organization, "offer"))
    return { error: t("chatDocs.errors.engine_missing") };
  try {
    return await withOrg(async (tx, { organization }) => {
      const d = await offerFormDefaults(tx, organization.id, leadId, quick.pkg);
      const g = guests !== undefined && /^\d{1,5}$/.test(guests) ? guests : d.guests;
      const suggested = suggestedOfferPrice(quick.pkg, g);
      return {
        values: {
          date: d.date,
          venue: d.venue,
          guests: g,
          hours: d.hours,
          price: suggested || d.price,
        },
        suggested,
        pkgName: quick.pkg[0].toUpperCase() + quick.pkg.slice(1),
      };
    });
  } catch (error) {
    return {
      error: error instanceof DocumentInputError ? error.message : t("mail.errors.send_failed"),
    };
  }
}

/** «Podgląd PDF»: PDF из текущих значений, ничего не сохраняется и этап не меняется. */
export async function previewQuickOfferAction(
  leadId: string,
  templateId: string,
  raw: unknown,
): Promise<{ pdf?: string; filename?: string; error?: string }> {
  const values = quickOfferValues.safeParse(raw);
  if (!values.success) return { error: values.error.issues[0]?.message ?? t("inbox.invalid") };
  if (!z.uuid().safeParse(leadId).success) return { error: t("inbox.invalid") };
  const quick = await quickTemplate(templateId);
  if (!quick) return { error: t("chatDocs.errors.engine_missing") };
  try {
    return await withOrg(async (tx, { organization }) => {
      const defaults = await offerFormDefaults(tx, organization.id, leadId, quick.pkg);
      const { pdf, filename } = await previewOffer(
        tx,
        organization.id,
        leadId,
        quick.pkg,
        { ...defaults, ...values.data, listPrice: "" },
        contactOf(organization),
      );
      return { pdf: Buffer.from(pdf).toString("base64"), filename };
    });
  } catch (error) {
    return {
      error: error instanceof DocumentInputError ? error.message : t("mail.errors.send_failed"),
    };
  }
}
