import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, createTestDb, createUser } from "./harness";
import { TYPE_PARSERS, type Database } from "@/lib/db/core";
import { ensureAgencyWorkspace } from "@/lib/db/bootstrap";

/** Модули бизнеса, права агентства на них, заявки клиента, автосоздание кабинета агентства. */
const ADMIN = "b0000000-0000-4000-8000-000000000001"; // админ платформы (OWO Ads)
const CLIENT = "b0000000-0000-4000-8000-000000000002"; // владелец фирмы клиента
const STRANGER = "b0000000-0000-4000-8000-000000000003";

let pg: PGlite;
let db: Database;
let agency: string;
let clientOrg: string;

const q = <T>(user: string, sql: string, params: unknown[] = []) =>
  asUser(pg, user, () => pg.query<T>(sql, params)).then((r) => r.rows);

const modules = async (org: string) =>
  (
    await pg.query<{ module: string }>(
      "select module from public.organization_modules where organization_id=$1 order by module",
      [org],
    )
  ).rows.map((r) => r.module);

beforeAll(async () => {
  pg = await createTestDb();
  const parsers = Object.fromEntries(Object.entries(TYPE_PARSERS).map(([k, v]) => [Number(k), v]));
  const wrap = (x: { query: PGlite["query"] }) => ({
    query: (sql: string, params?: unknown[]) => x.query(sql, params, { parsers }) as never,
  });
  db = { ...wrap(pg), transaction: (fn) => pg.transaction((tx) => fn(wrap(tx as never))) };
  for (const id of [ADMIN, CLIENT, STRANGER]) await createUser(pg, id);
  await pg.query("update auth.users set is_platform_admin=true where id=$1", [ADMIN]);
  // Фирма клиента: создаёт админ (как мастер «Utwórz CRM klienta»), владелец — клиент.
  clientOrg = (
    await q<{ id: string }>(ADMIN, "select public.create_organization('Klient','klient-b') as id")
  )[0].id;
  await pg.query(
    "insert into public.memberships (organization_id, user_id, role) values ($1,$2,'owner')",
    [clientOrg, CLIENT],
  );
});
afterAll(() => pg.close());

describe("кабинет агентства создаётся сам", () => {
  it("для админа платформы — один раз", async () => {
    const id = await ensureAgencyWorkspace(db, {}, () => {});
    expect(id).toBeTruthy();
    expect(await ensureAgencyWorkspace(db, {}, () => {})).toBeNull();
    const org = await pg.query<{ industry_preset: string; name: string }>(
      "select industry_preset, name from public.organizations where id=$1",
      [id],
    );
    expect(org.rows[0]).toEqual({ industry_preset: "agency", name: "OWO Ads" });
    agency = id!;
    await q(
      ADMIN,
      "insert into public.agency_clients (organization_id, name, client_org_id) values ($1,'Klient',$2)",
      [agency, clientOrg],
    );
  });
});

describe("модули", () => {
  it("новый бизнес стартует со всеми модулями (пробный период)", async () => {
    expect(await modules(clientOrg)).toEqual([
      "calendar",
      "channels",
      "documents",
      "leads",
      "payments",
    ]);
  });

  it("агентство меняет модули, клиент и посторонний — нет", async () => {
    await q(ADMIN, "select public.set_organization_modules($1, $2)", [clientOrg, ["documents"]]);
    expect(await modules(clientOrg)).toEqual(["documents", "leads"]);
    await expect(
      q(CLIENT, "select public.set_organization_modules($1, $2)", [clientOrg, ["calendar"]]),
    ).rejects.toThrow(/forbidden/);
    await expect(
      q(STRANGER, "select public.set_organization_modules($1, $2)", [clientOrg, ["calendar"]]),
    ).rejects.toThrow(/forbidden/);
    await expect(
      q(ADMIN, "select public.set_organization_modules($1, $2)", [clientOrg, ["hacking"]]),
    ).rejects.toThrow(/unknown module/);
    const has = await q<{ d: boolean; c: boolean; l: boolean }>(
      CLIENT,
      "select public.has_module($1,'documents') as d, public.has_module($1,'calendar') as c, public.has_module($1,'leads') as l",
      [clientOrg],
    );
    expect(has[0]).toEqual({ d: true, c: false, l: true });
  });

  it("клиент просит модуль, агентство видит заявку, включение закрывает её", async () => {
    await q(
      CLIENT,
      "insert into public.module_requests (organization_id, module, requested_by) values ($1,'calendar',$2)",
      [clientOrg, CLIENT],
    );
    // Повторная заявка на тот же модуль, пока первая открыта, — нельзя.
    await expect(
      q(
        CLIENT,
        "insert into public.module_requests (organization_id, module, requested_by) values ($1,'calendar',$2)",
        [clientOrg, CLIENT],
      ),
    ).rejects.toThrow();
    expect(
      await q(ADMIN, "select id from public.module_requests where handled_at is null"),
    ).toHaveLength(1);
    expect(await q(STRANGER, "select id from public.module_requests")).toHaveLength(0);
    await q(ADMIN, "select public.set_organization_modules($1, $2)", [
      clientOrg,
      ["documents", "calendar"],
    ]);
    expect(
      await q(ADMIN, "select id from public.module_requests where handled_at is null"),
    ).toHaveLength(0);
  });

  it("абонемент видят владелец и агентство, но не меняют напрямую", async () => {
    await pg.query(
      "insert into public.organization_billing (organization_id, status) values ($1,'active')",
      [clientOrg],
    );
    expect(await q(CLIENT, "select status from public.organization_billing")).toEqual([
      { status: "active" },
    ]);
    expect(await q(STRANGER, "select status from public.organization_billing")).toEqual([]);
    await expect(
      q(
        CLIENT,
        "update public.organization_billing set monthly_net_grosze=0 where organization_id=$1",
        [clientOrg],
      ),
    ).rejects.toThrow();
    const seats = await q<{ n: number }>(ADMIN, "select public.billable_seats($1) as n", [
      clientOrg,
    ]);
    // Команда агентства помечена обслуживающей (решение 038) и в места не считается.
    expect(seats[0].n).toBe(1); // только владелец фирмы клиента
  });

  it("чек-лист: шаг документов зависит от модуля, абонемент отмечается сам", async () => {
    const steps = async () =>
      Object.fromEntries(
        (
          await q<{ step_key: string; done_at: string | null }>(
            ADMIN,
            "select step_key, done_at from public.agency_setup_status($1)",
            [agency],
          )
        ).map((r) => [r.step_key, r.done_at !== null]),
      );
    let s = await steps();
    expect(s.subscription).toBe(true);
    expect("documents" in s).toBe(true);
    await q(ADMIN, "select public.set_organization_modules($1, $2)", [clientOrg, []]);
    s = await steps();
    expect("documents" in s).toBe(false);
  });
});
