import { asUser, one, type Database } from "../db/core.ts";
import { newToken, sha256 } from "../auth/crypto.ts";

export type InviteRole = "owner" | "admin" | "member";

/** Создаёт приглашение от имени пользователя (права проверяет SQL). Возвращает токен для ссылки. */
export async function createInvitation(
  db: Database,
  userId: string,
  orgId: string,
  role: InviteRole,
  note?: string,
) {
  const { token, hash } = newToken();
  await asUser(db, userId, (tx) =>
    tx.query("select public.create_invitation($1,$2,$3,$4)", [orgId, hash, role, note ?? null]),
  );
  return token;
}

/** Что показать на странице приглашения (без входа): название бизнеса и роль, если ссылка действует. */
export async function invitationInfo(db: Database, token: string) {
  return one<{ organization_id: string; organization: string; role: InviteRole }>(
    db,
    `select i.organization_id, o.name as organization, i.role from public.invitations i
     join public.organizations o on o.id = i.organization_id
     where i.token_hash = $1 and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()`,
    [sha256(token)],
  );
}

export async function acceptInvitation(db: Database, userId: string, token: string) {
  const row = await asUser(db, userId, (tx) =>
    one<{ org: string }>(tx, "select public.accept_invitation($1) as org", [sha256(token)]),
  );
  return row!.org;
}
