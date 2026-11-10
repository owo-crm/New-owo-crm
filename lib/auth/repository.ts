import { asUser, one, type Database } from "../db/core.ts";
import { DUMMY_HASH, hashPassword, newToken, sha256, verifyPassword } from "./crypto.ts";

/** Логика аккаунтов без Next.js — тестируется на PGlite. */

export const SESSION_DAYS = 30;

export type SessionUser = {
  id: string;
  email: string;
  fullName: string;
  isPlatformAdmin: boolean;
};

export type MemberOrganization = {
  id: string;
  name: string;
  slug: string;
  brandColor: string;
  industryPreset: string;
  role: "owner" | "admin" | "member";
  /** Генератор документов фирмы: "barowo" = фирменные оферты/меню/договоры из бота. */
  documentEngine: string | null;
  email: string | null;
  phone: string | null;
};

export class EmailTakenError extends Error {}

export async function createUser(
  db: Database,
  input: { email: string; password: string; fullName: string; platformAdmin?: boolean },
) {
  const email = input.email.trim().toLowerCase();
  const exists = await one(db, "select 1 from auth.users where email = $1", [email]);
  if (exists) throw new EmailTakenError();
  const row = await one<{ id: string }>(
    db,
    `insert into auth.users (email, password_hash, raw_user_meta_data, is_platform_admin)
     values ($1, $2, $3, $4) returning id`,
    [
      email,
      await hashPassword(input.password),
      { full_name: input.fullName },
      Boolean(input.platformAdmin),
    ],
  );
  return row!.id;
}

/** Проверяет пароль. Для несуществующего e-mail тратит то же время (защита от перебора адресов). */
export async function authenticate(db: Database, email: string, password: string) {
  const row = await one<{ id: string; password_hash: string }>(
    db,
    "select id, password_hash from auth.users where email = $1",
    [email.trim().toLowerCase()],
  );
  const ok = await verifyPassword(password, row?.password_hash ?? DUMMY_HASH);
  if (!row || !ok) return null;
  await db.query("update auth.users set last_sign_in_at = now() where id = $1", [row.id]);
  return row.id;
}

export async function createSession(db: Database, userId: string, userAgent?: string | null) {
  const { token, hash } = newToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400000);
  await db.query(
    "insert into auth.sessions (token_hash, user_id, expires_at, user_agent) values ($1, $2, $3, $4)",
    [hash, userId, expiresAt.toISOString(), userAgent?.slice(0, 300) ?? null],
  );
  return { token, expiresAt };
}

export async function getSessionUser(db: Database, token: string): Promise<SessionUser | null> {
  const row = await one<{
    id: string;
    email: string;
    raw_user_meta_data: { full_name?: unknown };
    is_platform_admin: boolean;
  }>(
    db,
    `select u.id, u.email, u.raw_user_meta_data, u.is_platform_admin from auth.sessions s
     join auth.users u on u.id = s.user_id where s.token_hash = $1 and s.expires_at > now()`,
    [sha256(token)],
  );
  if (!row) return null;
  const fullName = row.raw_user_meta_data?.full_name;
  return {
    id: row.id,
    email: row.email,
    fullName: typeof fullName === "string" ? fullName : "",
    isPlatformAdmin: row.is_platform_admin,
  };
}

export async function deleteSession(db: Database, token: string) {
  await db.query("delete from auth.sessions where token_hash = $1", [sha256(token)]);
}

/** Фирмы пользователя — через RLS (роль authenticated), как раньше в Supabase. */
export async function listOrganizations(
  db: Database,
  userId: string,
): Promise<MemberOrganization[]> {
  return asUser(db, userId, async (tx) => {
    const { rows } = await tx.query<MemberOrganization>(
      `select o.id, o.name, o.slug, o.brand_color as "brandColor", o.industry_preset as "industryPreset", m.role,
         o.document_engine as "documentEngine", o.email, o.phone
       from public.memberships m join public.organizations o on o.id = m.organization_id
       where m.user_id = $1 order by m.created_at`,
      [userId],
    );
    return rows;
  });
}

export async function createPasswordReset(db: Database, email: string) {
  const user = await one<{ id: string }>(db, "select id from auth.users where email = $1", [
    email.trim().toLowerCase(),
  ]);
  if (!user) return null;
  const { token, hash } = newToken();
  await db.query(
    "insert into auth.password_resets (token_hash, user_id, expires_at) values ($1, $2, now() + interval '1 hour')",
    [hash, user.id],
  );
  return token;
}

/** Одноразовая смена пароля; все старые сессии пользователя закрываются. */
export async function resetPassword(db: Database, token: string, password: string) {
  const passwordHash = await hashPassword(password);
  return db.transaction(async (tx) => {
    const reset = await one<{ user_id: string }>(
      tx,
      `update auth.password_resets set used_at = now()
       where token_hash = $1 and used_at is null and expires_at > now() returning user_id`,
      [sha256(token)],
    );
    if (!reset) return null;
    await tx.query("update auth.users set password_hash = $1 where id = $2", [
      passwordHash,
      reset.user_id,
    ]);
    await tx.query("delete from auth.sessions where user_id = $1", [reset.user_id]);
    return reset.user_id;
  });
}
