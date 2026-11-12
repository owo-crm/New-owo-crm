"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { fieldErrors, type FieldErrors } from "@/lib/auth/schemas";
import { profileSchema, saveOrganizationProfile } from "@/lib/organizations/profile";
import { MAX_UPLOAD_BYTES } from "@/lib/documents/attachments";
import { resetContractTemplate, saveContractTemplate } from "@/lib/documents/templates";
import { t } from "@/lib/i18n";

export type ProfileState = { errors?: FieldErrors; message?: string; ok?: boolean };

/** Сохраняет данные фирмы: шапку умовы, реквизиты, цвет бренда. */
export async function saveProfileAction(
  _prev: ProfileState,
  formData: FormData,
): Promise<ProfileState> {
  await requireRole(["owner", "admin"]);
  const parsed = profileSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  try {
    await saveOrganizationProfile(parsed.data);
  } catch (error) {
    console.error("[org] profile", (error as Error).message);
    return { message: t("common.unknownError") };
  }
  revalidatePath("/ustawienia/firma");
  revalidatePath("/", "layout");
  return { ok: true };
}

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export type TemplateState = { message?: string; ok?: boolean };

/** Загружает свой .docx вместо встроенного шаблона умовы. */
export async function uploadTemplateAction(
  _prev: TemplateState,
  formData: FormData,
): Promise<TemplateState> {
  await requireRole(["owner", "admin"]);
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { message: t("templates.noFile") };
  if (file.size > MAX_UPLOAD_BYTES) return { message: t("files.tooBig") };
  if (!file.name.toLowerCase().endsWith(".docx") || (file.type && file.type !== DOCX))
    return { message: t("templates.onlyDocx") };
  try {
    const content = Buffer.from(await file.arrayBuffer());
    await saveContractTemplate(file.name.replace(/[/\\]/g, "_").slice(0, 200), content);
  } catch (error) {
    console.error("[org] template upload", (error as Error).message);
    return { message: t("common.unknownError") };
  }
  revalidatePath("/ustawienia/szablony");
  return { ok: true };
}

/** Возвращает встроенный шаблон. */
export async function resetTemplateAction(): Promise<TemplateState> {
  await requireRole(["owner", "admin"]);
  await resetContractTemplate();
  revalidatePath("/ustawienia/szablony");
  return { ok: true };
}
