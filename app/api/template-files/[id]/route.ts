import { z } from "zod";
import { withOrg } from "@/lib/db/user";
import { one } from "@/lib/db";

// Готовый PDF шаблона фирмы (решение 053): только члены фирмы (RLS), без публичных ссылок.
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: RouteContext<"/api/template-files/[id]">) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return new Response(null, { status: 404 });
  const file = await withOrg((tx, { organization }) =>
    one<{ filename: string; content: Buffer }>(
      tx,
      "select filename, content from public.template_files where organization_id=$1 and id=$2",
      [organization.id, id],
    ),
  );
  if (!file) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(file.content), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
