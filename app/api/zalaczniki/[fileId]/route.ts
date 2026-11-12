import { z } from "zod";
import { readAttachment } from "@/lib/documents/attachments";

/**
 * Скачивание своего файла, приложенного к лиду. Только члены фирмы (RLS).
 * Содержимое всегда отдаём вложением: чужой файл не должен исполняться в браузере.
 */
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: RouteContext<"/api/zalaczniki/[fileId]">) {
  const { fileId } = await params;
  if (!z.uuid().safeParse(fileId).success) return new Response(null, { status: 404 });
  const file = await readAttachment(fileId);
  if (!file) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(file.content), {
    headers: {
      "Content-Type": file.content_type || "application/octet-stream",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
