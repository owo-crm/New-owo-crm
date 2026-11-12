"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { addAttachment, removeAttachment, MAX_UPLOAD_BYTES } from "./attachments";
import { t } from "@/lib/i18n";

/** Загрузка своих файлов к лиду. Размер и имя проверяем до записи в базу. */
export type UploadResult = { ok?: true; error?: string };

export async function uploadAttachmentAction(form: FormData): Promise<UploadResult> {
  const leadId = z.uuid().safeParse(form.get("leadId"));
  const file = form.get("file");
  if (!leadId.success || !(file instanceof File) || file.size === 0)
    return { error: t("attachments.pickFile") };
  if (file.size > MAX_UPLOAD_BYTES) return { error: t("attachments.tooBig") };

  const name = file.name.replace(/[/\\]/g, "_").slice(0, 200) || "plik";
  const note = String(form.get("note") ?? "")
    .trim()
    .slice(0, 300);
  try {
    await addAttachment({
      leadId: leadId.data,
      filename: name,
      contentType: file.type || "application/octet-stream",
      content: Buffer.from(await file.arrayBuffer()),
      note: note || null,
    });
  } catch {
    return { error: t("attachments.failed") };
  }
  revalidatePath(`/leady/${leadId.data}`);
  return { ok: true };
}

export async function deleteAttachmentAction(id: string, leadId: string): Promise<UploadResult> {
  const parsed = z.object({ id: z.uuid(), leadId: z.uuid() }).safeParse({ id, leadId });
  if (!parsed.success) return { error: t("attachments.failed") };
  await removeAttachment(parsed.data.id).catch(() => null);
  revalidatePath(`/leady/${parsed.data.leadId}`);
  return { ok: true };
}
