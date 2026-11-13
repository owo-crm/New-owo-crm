import { createUser } from "../auth/repository.ts";
import { hashPassword, verifyPassword } from "../auth/crypto.ts";
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
    // Триггер уже добавил админов как обслуживающих — в своём кабинете они владельцы.
    for (const admin of admins)
      await tx.query(
        `insert into public.memberships (organization_id, user_id, role) values ($1, $2, 'owner')
         on conflict (organization_id, user_id) do update set role = 'owner', is_service = false`,
        [rows[0].id, admin.id],
      );
    // Зашитые услуги: кабинет создаётся после миграций, поэтому заводим их здесь.
    await tx.query("select public.agency_ensure_system_services($1)", [rows[0].id]);
    return rows[0].id;
  });
  log(`Agencja: utworzono kabinet „${name}” (${id}) dla administratorów platformy.`);
  return id;
}

/**
 * Главный админ из переменных Railway: ADMIN_LOGIN + ADMIN_PASSWORD (+ ADMIN_NAME).
 * При каждом запуске: нет аккаунта — создаём; есть — делаем админом платформы, а если пароль
 * в переменных поменяли — меняем пароль и закрываем старые сессии. Затем админы платформы
 * получают доступ ко всем бизнесам (решение 023). Пароль только в Railway, не в коде.
 */
export async function ensurePlatformAdmin(
  db: Database,
  env: Record<string, string | undefined>,
  log = console.log,
) {
  const login = env.ADMIN_LOGIN?.trim().toLowerCase();
  const password = env.ADMIN_PASSWORD ?? "";
  let result: "created" | "updated" | "unchanged" | null = null;
  if (login) {
    if (password.length < 10) throw new Error("ADMIN_PASSWORD musi mieć co najmniej 10 znaków.");
    const { rows } = await db.query<{
      id: string;
      password_hash: string;
      is_platform_admin: boolean;
    }>("select id, password_hash, is_platform_admin from auth.users where email = $1", [login]);
    const user = rows[0];
    if (!user) {
      await createUser(db, {
        email: login,
        password,
        fullName: env.ADMIN_NAME || login.split("@")[0],
        platformAdmin: true,
      });
      result = "created";
    } else {
      const samePassword = await verifyPassword(password, user.password_hash);
      if (!samePassword) {
        await db.query("update auth.users set password_hash = $2 where id = $1", [
          user.id,
          await hashPassword(password),
        ]);
        await db.query("delete from auth.sessions where user_id = $1", [user.id]);
      }
      if (!user.is_platform_admin)
        await db.query("update auth.users set is_platform_admin = true where id = $1", [user.id]);
      result = samePassword && user.is_platform_admin ? "unchanged" : "updated";
    }
    if (result !== "unchanged")
      log(`Admin: konto ${login} — ${result === "created" ? "utworzone" : "zaktualizowane"}.`);
  }
  const { rows } = await db.query<{ n: number }>(
    "select public.sync_platform_admin_memberships() as n",
  );
  if (rows[0].n > 0) log(`Admin: dodano dostęp do biznesów: ${rows[0].n}.`);
  return result;
}

/**
 * Каждый бизнес установки (кроме кабинетов агентства) — клиент в кабинете OWO Ads.
 * Запускается при старте: уже созданные бизнесы (Barowo и др.) появятся в «Agencja» сами,
 * с привязанной CRM, и их доход (абонемент, заказы) начнёт считаться. Повтор ничего не дублирует.
 */
export async function linkBusinessesToAgency(db: Database, log = console.log) {
  const { rows } = await db.query<{ n: number }>(
    `with agency as (
       select o.id from public.organizations o
       where o.industry_preset = 'agency'
         and exists (select 1 from public.memberships m join auth.users u on u.id = m.user_id
                     where m.organization_id = o.id and u.is_platform_admin)
       order by o.created_at limit 1
     ), added as (
       insert into public.agency_clients (organization_id, name, client_org_id, status, started_at)
       select a.id, left(c.name, 200), c.id, 'active', (c.created_at at time zone 'Europe/Warsaw')::date
       from agency a cross join public.organizations c
       where c.industry_preset <> 'agency'
         and not exists (select 1 from public.agency_clients x where x.organization_id = a.id and x.client_org_id = c.id)
       returning 1
     )
     select count(*)::int as n from added`,
  );
  if (rows[0].n > 0) log(`Agencja: dodano klientów z istniejących biznesów: ${rows[0].n}.`);
  return rows[0].n;
}

/**
 * Удаление лишних аккаунтов (решение 031): ADMIN_REMOVE_LOGINS — логины через запятую,
 * по умолчанию «test01» (тестовый аккаунт первой настройки). Всё, чем аккаунт владеет,
 * переходит главному админу (ADMIN_LOGIN): владение бизнесами, услуги, вклады, лиды.
 * Затем аккаунт удаляется вместе с сессиями и участием. Без ADMIN_LOGIN ничего не делается.
 */
export async function removeAccounts(
  db: Database,
  env: Record<string, string | undefined>,
  log = console.log,
) {
  const heirLogin = env.ADMIN_LOGIN?.trim().toLowerCase();
  if (!heirLogin) return 0;
  const logins = (env.ADMIN_REMOVE_LOGINS ?? "test01")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s && s !== heirLogin);
  let removed = 0;
  for (const login of logins) {
    const done = await db.transaction(async (tx) => {
      const { rows } = await tx.query<{ id: string; email: string }>(
        "select id, email from auth.users where email = any($1::text[])",
        [[login, heirLogin]],
      );
      const old = rows.find((r) => r.email === login);
      const heir = rows.find((r) => r.email === heirLogin);
      if (!old || !heir) return false;
      // Где старый был владельцем — владельцем становится главный админ (без пометки «сервис»).
      await tx.query(
        `insert into public.memberships (organization_id, user_id, role, is_service)
         select m.organization_id, $2, 'owner', false from public.memberships m
         where m.user_id = $1 and m.role = 'owner'
         on conflict (organization_id, user_id) do update set role = 'owner', is_service = false`,
        [old.id, heir.id],
      );
      await tx.query("update public.agency_services set owner_id = $2 where owner_id = $1", [
        old.id,
        heir.id,
      ]);
      await tx.query(
        "update public.agency_fund_contributions set user_id = $2 where user_id = $1",
        [old.id, heir.id],
      );
      await tx.query("update public.leads set assigned_to = $2 where assigned_to = $1", [
        old.id,
        heir.id,
      ]);
      await tx.query("delete from auth.users where id = $1", [old.id]);
      return true;
    });
    if (done) {
      removed++;
      log(`Admin: usunięto konto ${login}, jego biznesy przejęło konto ${heirLogin}.`);
    }
  }
  return removed;
}

/**
 * Ключи VAPID для push-уведомлений (решение 043). Если их нет в переменных Railway
 * (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY), создаём пару один раз и храним в platform_secrets —
 * так push работает без ручной генерации ключей на компьютере.
 */
export async function ensureVapidKeys(
  db: Database,
  env: Record<string, string | undefined>,
  log = console.log,
) {
  if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) return false;
  const { rows } = await db.query<{ n: number }>(
    "select count(*)::int as n from public.platform_secrets where key in ('vapid_public_key','vapid_private_key')",
  );
  if (rows[0].n === 2) return false;
  const webpush = (await import("web-push")).default;
  const keys = webpush.generateVAPIDKeys();
  await db.query(
    `insert into public.platform_secrets (key, value) values ('vapid_public_key', $1), ('vapid_private_key', $2)
     on conflict (key) do update set value = excluded.value`,
    [keys.publicKey, keys.privateKey],
  );
  log("Push: utworzono klucze VAPID.");
  return true;
}
