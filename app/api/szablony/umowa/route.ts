import { withOrg } from "@/lib/db/user";
import { contractTemplate } from "@/lib/documents/templates";

/** Скачать действующий шаблон умовы: свой, если загружен, иначе встроенный. */
export async function GET() {
  const file = await withOrg(async (tx, { organization }) => {
    const { rows } = await tx.query<{ filename: string }>(
      "select filename from public.organization_templates where organization_id=$1 and kind='contract'",
      [organization.id],
    );
    return {
      name: rows[0]?.filename ?? "umowa-szablon.docx",
      content: await contractTemplate(tx, organization.id),
    };
  });
  return new Response(new Uint8Array(file.content), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${file.name.replace(/[^\w.-]/g, "_")}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
