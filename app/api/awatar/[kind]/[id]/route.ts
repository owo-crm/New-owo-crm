import { z } from "zod";
import { getDb } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { readOrganizationAvatar, readProfileAvatar } from "@/lib/avatars/repository";

/**
 * Аватарка кабинета (o) или человека (u). Видна только тем, кому RLS разрешает:
 * членам кабинета и коллегам. Адрес содержит версию (?v=), поэтому кэш долгий.
 */
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: RouteContext<"/api/awatar/[kind]/[id]">) {
  const { kind, id } = await params;
  if (!["o", "u"].includes(kind) || !z.uuid().safeParse(id).success)
    return new Response(null, { status: 404 });
  const user = await getCurrentUser();
  if (!user) return new Response(null, { status: 401 });
  const avatar =
    kind === "o"
      ? await readOrganizationAvatar(getDb(), user.id, id)
      : await readProfileAvatar(getDb(), user.id, id);
  if (!avatar) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(avatar.content), {
    headers: {
      "Content-Type": avatar.content_type,
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'",
    },
  });
}
