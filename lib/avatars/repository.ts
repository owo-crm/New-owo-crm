import { asUser, one, type Database } from "../db/core.ts";
import type { AvatarType } from "./image.ts";

/** Чтение и запись аватарок под RLS (роль authenticated). */
export type StoredAvatar = { content: Buffer; content_type: AvatarType };

export function readOrganizationAvatar(db: Database, userId: string, organizationId: string) {
  return asUser(db, userId, (tx) =>
    one<StoredAvatar>(
      tx,
      "select content, content_type from public.organization_avatars where organization_id = $1",
      [organizationId],
    ),
  );
}

export function readProfileAvatar(db: Database, userId: string, ownerId: string) {
  return asUser(db, userId, (tx) =>
    one<StoredAvatar>(
      tx,
      "select content, content_type from public.profile_avatars where user_id = $1",
      [ownerId],
    ),
  );
}

export function saveOrganizationAvatar(
  db: Database,
  userId: string,
  organizationId: string,
  file: { content: Buffer; type: AvatarType } | null,
) {
  return asUser(db, userId, async (tx) => {
    if (!file) {
      await tx.query("delete from public.organization_avatars where organization_id = $1", [
        organizationId,
      ]);
      return;
    }
    // Не owner/admin → RLS отклонит запись ошибкой 42501.
    await tx.query(
      `insert into public.organization_avatars (organization_id, content_type, size_bytes, content, updated_by)
       values ($1, $2, $3, $4, $5)
       on conflict (organization_id) do update
         set content_type = excluded.content_type, size_bytes = excluded.size_bytes,
             content = excluded.content, updated_by = excluded.updated_by, updated_at = now()`,
      [organizationId, file.type, file.content.length, file.content, userId],
    );
  });
}

export function saveProfileAvatar(
  db: Database,
  userId: string,
  file: { content: Buffer; type: AvatarType } | null,
) {
  return asUser(db, userId, async (tx) => {
    if (!file) {
      await tx.query("delete from public.profile_avatars where user_id = $1", [userId]);
      return;
    }
    await tx.query(
      `insert into public.profile_avatars (user_id, content_type, size_bytes, content)
       values ($1, $2, $3, $4)
       on conflict (user_id) do update
         set content_type = excluded.content_type, size_bytes = excluded.size_bytes,
             content = excluded.content, updated_at = now()`,
      [userId, file.type, file.content.length, file.content],
    );
  });
}
