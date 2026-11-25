import { asUser, one, type Database } from "../db/core.ts";
import { newToken } from "../auth/crypto.ts";

/**
 * Первый владелец кабинета клиента агентства (docs/architecture/ADAM_REAL_ESTATE_PHASE0.md).
 * Все проверки — в SQL (create_client_owner_invitation): админ платформы, связь client,
 * нет владельца-человека. Токен возвращается один раз и нигде не сохраняется/не логируется.
 */
export async function createClientOwnerInvite(
  db: Database,
  userId: string,
  agencyOrg: string,
  clientOrg: string,
) {
  const { token, hash } = newToken();
  await asUser(db, userId, (tx) =>
    tx.query("select public.create_client_owner_invitation($1,$2,$3)", [
      agencyOrg,
      clientOrg,
      hash,
    ]),
  );
  return token;
}

export async function revokeClientOwnerInvite(
  db: Database,
  userId: string,
  agencyOrg: string,
  clientOrg: string,
) {
  const row = await asUser(db, userId, (tx) =>
    one<{ n: number }>(tx, "select public.revoke_client_owner_invitation($1,$2) as n", [
      agencyOrg,
      clientOrg,
    ]),
  );
  return row?.n ?? 0;
}

export async function clientOwnerStatus(
  db: Database,
  userId: string,
  agencyOrg: string,
  clientOrg: string,
) {
  const row = await asUser(db, userId, (tx) =>
    one<{ has_owner: boolean; pending_expires_at: Date | null }>(
      tx,
      "select * from public.client_owner_status($1,$2)",
      [agencyOrg, clientOrg],
    ),
  );
  return { hasOwner: row?.has_owner ?? false, pendingUntil: row?.pending_expires_at ?? null };
}
