"use server";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { requireOrganization } from "@/lib/auth/session";
import { t } from "@/lib/i18n";
import { checkAvatar } from "./image";
import { saveOrganizationAvatar, saveProfileAvatar } from "./repository";

export type AvatarResult = { ok?: true; error?: string };

/** Файл из формы → проверенная картинка. Пустое поле remove=1 — удалить аватарку. */
async function readFile(form: FormData) {
  if (form.get("remove") === "1") return { file: null };
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: t("avatar.pick") };
  const content = Buffer.from(await file.arrayBuffer());
  const check = checkAvatar(content);
  if (!check.ok) return { error: t(check.error === "size" ? "avatar.tooBig" : "avatar.badType") };
  return { file: { content, type: check.type } };
}

export async function uploadOrganizationAvatar(form: FormData): Promise<AvatarResult> {
  const { user, organization } = await requireOrganization();
  if (!["owner", "admin"].includes(organization.role)) return { error: t("avatar.forbidden") };
  const read = await readFile(form);
  if ("error" in read) return { error: read.error };
  try {
    await saveOrganizationAvatar(getDb(), user.id, organization.id, read.file);
  } catch {
    return { error: t("avatar.failed") };
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function uploadProfileAvatar(form: FormData): Promise<AvatarResult> {
  const { user } = await requireOrganization();
  const read = await readFile(form);
  if ("error" in read) return { error: read.error };
  try {
    await saveProfileAvatar(getDb(), user.id, read.file);
  } catch {
    return { error: t("avatar.failed") };
  }
  revalidatePath("/", "layout");
  return { ok: true };
}
