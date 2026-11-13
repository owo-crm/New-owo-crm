import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, createTestDb, createUser } from "./harness";
import { TYPE_PARSERS, type Database } from "@/lib/db/core";
import {
  ensureAgencyWorkspace,
  ensurePlatformAdmin,
  linkBusinessesToAgency,
  removeAccounts,
  ensureVapidKeys,
} from "@/lib/db/bootstrap";
import { authenticate } from "@/lib/auth/repository";

/** Админ из переменных Railway видит все бизнесы: старые, новые и кабинет агентства. */
const IVAN = "d0000000-0000-4000-8000-000000000001"; // владелец Barowo
const KLIENT = "d0000000-0000-4000-8000-000000000002";
let pg: PGlite;
let db: Database;

const env = { ADMIN_LOGIN: "Szef.OWO", ADMIN_PASSWORD: "bardzo-tajne-haslo", ADMIN_NAME: "Szef" };

const roles = async (login: string) =>
  (
    await pg.query<{ name: string; role: string; is_service: boolean }>(
      `select o.name, m.role, m.is_service from public.memberships m
       join public.organizations o on o.id = m.organization_id
       join auth.users u on u.id = m.user_id where u.email = $1 order by o.name`,
      [login],
    )
  ).rows;

beforeAll(async () => {
  pg = await createTestDb();
  const parsers = Object.fromEntries(Object.entries(TYPE_PARSERS).map(([k, v]) => [Number(k), v]));
  const wrap = (x: { query: PGlite["query"] }) => ({
    query: (sql: string, params?: unknown[]) => x.query(sql, params, { parsers }) as never,
  });
  db = { ...wrap(pg), transaction: (fn) => pg.transaction((tx) => fn(wrap(tx as never))) };
  await createUser(pg, IVAN);
  await createUser(pg, KLIENT);
  await asUser(pg, IVAN, () => pg.query("select public.create_organization('Barowo','barowo')"));
});
afterAll(() => pg.close());

describe("админ платформы из переменных", () => {
  it("создаётся, входит по логину и получает доступ ко всем бизнесам", async () => {
    expect(await ensurePlatformAdmin(db, env, () => {})).toBe("created");
    expect(await authenticate(db, "szef.owo", env.ADMIN_PASSWORD)).toBeTruthy();
    await ensureAgencyWorkspace(db, {}, () => {});
    expect(await roles("szef.owo")).toEqual([
      { name: "Barowo", role: "admin", is_service: true },
      { name: "OWO Ads", role: "owner", is_service: false },
    ]);
  });

  it("новый бизнес любого пользователя сразу виден админу; клиент не может его убрать", async () => {
    const org = (
      await asUser(pg, KLIENT, () =>
        pg.query<{ id: string }>("select public.create_organization('Studio','studio') as id"),
      )
    ).rows[0].id;
    expect((await roles("szef.owo")).map((r) => r.name)).toContain("Studio");
    const admin = (
      await pg.query<{ id: string }>("select id from auth.users where email='szef.owo'")
    ).rows[0].id;
    await asUser(pg, KLIENT, () =>
      pg.query("delete from public.memberships where organization_id=$1 and user_id=$2", [
        org,
        admin,
      ]),
    );
    expect((await roles("szef.owo")).map((r) => r.name)).toContain("Studio");
  });

  it("повторный запуск ничего не меняет, новый пароль в переменных — меняет пароль", async () => {
    expect(await ensurePlatformAdmin(db, env, () => {})).toBe("unchanged");
    expect(
      await ensurePlatformAdmin(db, { ...env, ADMIN_PASSWORD: "nowe-haslo-123" }, () => {}),
    ).toBe("updated");
    expect(await authenticate(db, "szef.owo", env.ADMIN_PASSWORD)).toBeNull();
    expect(await authenticate(db, "szef.owo", "nowe-haslo-123")).toBeTruthy();
    await expect(
      ensurePlatformAdmin(db, { ADMIN_LOGIN: "x", ADMIN_PASSWORD: "krotkie" }, () => {}),
    ).rejects.toThrow();
  });

  it("все бизнесы становятся клиентами кабинета OWO Ads, повтор без дублей", async () => {
    expect(await linkBusinessesToAgency(db, () => {})).toBe(2); // Barowo + Studio
    expect(await linkBusinessesToAgency(db, () => {})).toBe(0);
    const names = (
      await pg.query<{ name: string }>("select name from public.agency_clients order by name")
    ).rows.map((r) => r.name);
    expect(names).toEqual(["Barowo", "Studio"]);
  });

  it("второй админ платформы в кабинете агентства — владелец, а не обслуживающий аккаунт", async () => {
    await ensurePlatformAdmin(
      db,
      { ADMIN_LOGIN: "drugi", ADMIN_PASSWORD: "bardzo-tajne-2" },
      () => {},
    );
    const agencyRole = (await roles("drugi")).find((r) => r.name === "OWO Ads");
    expect(agencyRole).toEqual({ name: "OWO Ads", role: "owner", is_service: false });
    expect((await roles("drugi")).find((r) => r.name === "Barowo")).toEqual({
      name: "Barowo",
      role: "admin",
      is_service: true,
    });
  });

  it("test01 удаляется, его бизнесы, услуги и вклады переходят главному админу", async () => {
    await pg.query(
      "insert into auth.users (id, email, password_hash, is_platform_admin) values ('d0000000-0000-4000-8000-0000000000aa','test01','x',true)",
    );
    await pg.query("select public.sync_platform_admin_memberships()");
    const agency = (
      await pg.query<{ id: string }>("select id from public.organizations where name='OWO Ads'")
    ).rows[0].id;
    await pg.query(
      "insert into public.agency_services (organization_id, name, owner_id) values ($1,'Strony','d0000000-0000-4000-8000-0000000000aa')",
      [agency],
    );
    expect(await removeAccounts(db, env, () => {})).toBe(1);
    expect((await pg.query("select 1 from auth.users where email='test01'")).rows).toHaveLength(0);
    const owner = await pg.query<{ email: string }>(
      "select u.email from public.agency_services s join auth.users u on u.id = s.owner_id where s.name='Strony'",
    );
    expect(owner.rows[0].email).toBe("szef.owo");
    expect(await removeAccounts(db, env, () => {})).toBe(0);
  });

  it("ключи VAPID для push создаются сами один раз, если их нет в переменных", async () => {
    expect(await ensureVapidKeys(db, {}, () => {})).toBe(true);
    expect(await ensureVapidKeys(db, {}, () => {})).toBe(false);
    const keys = await pg.query<{ key: string }>(
      "select key from public.platform_secrets order by key",
    );
    expect(keys.rows.map((r) => r.key)).toEqual(["vapid_private_key", "vapid_public_key"]);
    expect(
      await ensureVapidKeys(db, { VAPID_PUBLIC_KEY: "x", VAPID_PRIVATE_KEY: "y" }, () => {}),
    ).toBe(false);
  });
});
