import { createUser } from "../auth/repository.ts";
import type { Database } from "./core.ts";

/**
 * Первый запуск: если в базе нет ни одного пользователя и заданы BOOTSTRAP_ADMIN_EMAIL +
 * BOOTSTRAP_ADMIN_PASSWORD — создаёт администратора и его фирму. Пароль задаётся только
 * в переменных Railway (не в коде и не в чате); после первого входа переменные удалить.
 */
export async function bootstrapAdmin(
  db: Database,
  env: Record<string, string | undefined>,
  log = console.log,
) {
  const email = env.BOOTSTRAP_ADMIN_EMAIL?.trim();
  const password = env.BOOTSTRAP_ADMIN_PASSWORD ?? "";
  if (!email) return null;
  const { rows } = await db.query<{ n: number }>("select count(*)::int as n from auth.users");
  if (rows[0].n > 0) {
    log("Bootstrap: użytkownicy już istnieją — pomijam. Usuń zmienne BOOTSTRAP_* w Railway.");
    return null;
  }
  if (password.length < 10)
    throw new Error("BOOTSTRAP_ADMIN_PASSWORD musi mieć co najmniej 10 znaków.");
  const userId = await createUser(db, {
    email,
    password,
    fullName: env.BOOTSTRAP_ADMIN_NAME || email.split("@")[0],
    platformAdmin: true,
  });
  const orgName = env.BOOTSTRAP_ORG_NAME || "Barowo";
  const org = await db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
    const { rows: r } = await tx.query<{ id: string }>(
      "select public.create_organization($1, $2, 'event-services') as id",
      [
        orgName,
        orgName
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "") || "firma",
      ],
    );
    await tx.query(
      "update public.organizations set document_engine=$1, email=$2, phone=$3 where id=$4",
      [
        env.BOOTSTRAP_DOCUMENT_ENGINE ?? "barowo",
        env.BOOTSTRAP_ORG_EMAIL || null,
        env.BOOTSTRAP_ORG_PHONE || null,
        r[0].id,
      ],
    );
    return r[0].id;
  });
  log(`Bootstrap: utworzono administratora ${email} i firmę ${orgName} (${org}).`);
  return { userId, org };
}

/**
 * Кабинет самого агентства создаётся сам: если есть админ платформы, а бизнеса с пресетом
 * agency, где он участник, нет — создаём «OWO Ads» (имя — AGENCY_ORG_NAME) и добавляем туда
 * всех админов платформы владельцами. Повторный запуск ничего не меняет.
 */
export async function ensureAgencyWorkspace(
  db: Database,
  env: Record<string, string | undefined>,
  log = console.log,
) {
  const { rows: admins } = await db.query<{ id: string }>(
    "select id from auth.users where is_platform_admin order by created_at",
  );
  if (admins.length === 0) return null;
  const { rows: existing } = await db.query<{ id: string }>(
    `select o.id from public.organizations o
     where o.industry_preset = 'agency'
       and exists (select 1 from public.memberships m join auth.users u on u.id = m.user_id
                   where m.organization_id = o.id and u.is_platform_admin)
     limit 1`,
  );
  if (existing.length) return null;
  const name = env.AGENCY_ORG_NAME || "OWO Ads";
  const id = await db.transaction(async (tx) => {
    const { rows } = await tx.query<{ id: string }>(
      `insert into public.organizations (name, slug, industry_preset)
       values ($1, $2 || '-' || substr(md5(random()::text), 1, 4), 'agency') returning id`,
      [
        name,
        name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "") || "agencja",
      ],
    );
    for (const admin of admins)
      await tx.query(
        "insert into public.memberships (organization_id, user_id, role) values ($1, $2, 'owner')",
        [rows[0].id, admin.id],
      );
    return rows[0].id;
  });
  log(`Agencja: utworzono kabinet „${name}” (${id}) dla administratorów platformy.`);
  return id;
}
