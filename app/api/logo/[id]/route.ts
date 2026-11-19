import { z } from "zod";
import { getDb } from "@/lib/db";

/**
 * Логотип кабинета для писем (решение 051): открывается без входа, потому что его видит
 * клиент в почте. Это только картинка, которую фирма сама показывает клиентам; фото людей
 * (profile_avatars) так не отдаются.
 */
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: RouteContext<"/api/logo/[id]">) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return new Response(null, { status: 404 });
  const { rows } = await getDb().query<{ content: Buffer; content_type: string }>(
    "select content, content_type from public.organization_avatars where organization_id = $1",
    [id],
  );
  const logo = rows[0];
  if (!logo) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(logo.content), {
    headers: {
      "Content-Type": logo.content_type,
      "Cache-Control": "public, max-age=86400",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'",
    },
  });
}
