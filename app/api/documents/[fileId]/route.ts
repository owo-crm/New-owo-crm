import { z } from "zod";
import { withOrg } from "@/lib/db/user";
import { one } from "@/lib/db";

// Скачивание PDF/DOCX: только члены фирмы (RLS), без публичных ссылок.
export const dynamic = "force-dynamic";
const MIME = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
} as const;

export async function GET(request: Request, { params }: RouteContext<"/api/documents/[fileId]">) {
  const { fileId } = await params;
  if (!z.uuid().safeParse(fileId).success) return new Response(null, { status: 404 });
  const file = await withOrg((tx, { organization }) =>
    one<{ filename: string; format: keyof typeof MIME; content: Buffer }>(
      tx,
      "select filename, format, content from public.document_files where organization_id=$1 and id=$2",
      [organization.id, fileId],
    ),
  );
  if (!file) return new Response(null, { status: 404 });
  const inline = new URL(request.url).searchParams.get("podglad") === "1" && file.format === "pdf";
  return new Response(new Uint8Array(file.content), {
    headers: {
      "Content-Type": MIME[file.format],
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
