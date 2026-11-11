import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, createTestDb, createUser } from "./harness";
import { TYPE_PARSERS, type Database } from "@/lib/db/core";
import { ensureAgencyWorkspace, ensurePlatformAdmin } from "@/lib/db/bootstrap";
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
});
