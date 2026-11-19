import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { asUser, createTestDb, createUser } from "./harness";

/** M1.3: platform_managed_orgs — источник истины связей агентства (D-02, D-21). */
const ADMIN = "f1000000-0000-4000-8000-000000000001"; // админ платформы
const PARTNER = "f1000000-0000-4000-8000-000000000002"; // админ агентства, не админ платформы
const IVAN = "f1000000-0000-4000-8000-000000000003"; // владелец Barowo
const NEWBIE = "f1000000-0000-4000-8000-000000000004";

const MIGRATION = "20261119000039_platform_core.sql";
const dir = path.resolve(__dirname, "../../db/migrations");

describe("миграция 0039 на базе как в продакшне (OWO Ads + Barowo)", () => {
  let db: PGlite;
  let agency: string;
  let barowo: string;
  let other: string;
  beforeAll(async () => {
    db = new PGlite();
    for (const f of readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort())
      if (f < MIGRATION) await db.exec(readFileSync(path.join(dir, f), "utf8"));
    for (const id of [ADMIN, PARTNER, IVAN]) await createUser(db, id);
    await db.query("update auth.users set is_platform_admin=true where id=$1", [ADMIN]);
    agency = (
      await asUser(db, ADMIN, () =>
        db.query<{ id: string }>(
          "select public.create_organization('OWO Ads','owo','agency') as id",
        ),
      )
    ).rows[0].id;
    barowo = (
      await asUser(db, IVAN, () =>
        db.query<{ id: string }>("select public.create_organization('Barowo','barowo') as id"),
      )
    ).rows[0].id;
    other = (
      await asUser(db, IVAN, () =>
        db.query<{ id: string }>("select public.create_organization('Inna Firma','inna') as id"),
      )
    ).rows[0].id;
    // Старая автопривязка при старте: Barowo и «Inna» — строки agency_clients без created_by.
    await db.query(
      `insert into public.agency_clients (organization_id, name, client_org_id, status)
       values ($1,'Barowo',$2,'active'),($1,'Inna Firma',$3,'active')`,
      [agency, barowo, other],
    );
    await db.exec(readFileSync(path.join(dir, MIGRATION), "utf8"));
  });
  afterAll(() => db.close());

  it("Barowo — service, остальные без связи; agency_clients не тронута; аудит и staff заполнены", async () => {
    const rel = await db.query<{ org_id: string; relation: string; agency_org_id: string }>(
      "select org_id, relation, agency_org_id from public.platform_managed_orgs",
    );
    expect(rel.rows).toEqual([{ org_id: barowo, relation: "service", agency_org_id: agency }]);
    const ac = await db.query<{ n: number }>(
      "select count(*)::int as n from public.agency_clients",
    );
    expect(ac.rows[0].n).toBe(2);
    const audit = await db.query<{ action: string; organization_id: string }>(
      "select action, organization_id from public.audit_log",
    );
    expect(audit.rows).toEqual([{ action: "relation.create", organization_id: barowo }]);
    const staff = await db.query<{ user_id: string }>("select user_id from public.platform_staff");
    expect(staff.rows).toEqual([{ user_id: ADMIN }]);
  });

  it("доступ агентства к Barowo сохраняется, к организации без связи — нет", async () => {
    await db.query(
      "insert into public.memberships (organization_id, user_id, role) values ($1,$2,'admin')",
      [agency, PARTNER],
    );
    const can = (org: string) =>
      asUser(db, PARTNER, () =>
        db.query<{ ok: boolean }>("select public.manages_organization($1) as ok", [org]),
      ).then((r) => r.rows[0].ok);
    expect(await can(barowo)).toBe(true);
    expect(await can(other)).toBe(false);
    // Новый админ агентства получил сервисный доступ в Barowo (синхронизация по связи).
    const m = await db.query<{ role: string; is_service: boolean }>(
      "select role, is_service from public.memberships where organization_id=$1 and user_id=$2",
      [barowo, PARTNER],
    );
    expect(m.rows[0]).toEqual({ role: "admin", is_service: true });
  });
});

describe("явное создание связи после M1.3", () => {
  let db: PGlite;
  let agency: string;
  beforeAll(async () => {
    db = await createTestDb();
    for (const id of [ADMIN, PARTNER, IVAN, NEWBIE]) await createUser(db, id);
    await db.query("update auth.users set is_platform_admin=true where id=$1", [ADMIN]);
    agency = (
      await asUser(db, ADMIN, () =>
        db.query<{ id: string }>(
          "select public.create_organization('OWO Ads','owo2','agency') as id",
        ),
      )
    ).rows[0].id;
    await db.query(
      "insert into public.memberships (organization_id, user_id, role) values ($1,$2,'admin')",
      [agency, PARTNER],
    );
  });
  afterAll(() => db.close());

  it("«Nowy biznes» (строка agency_clients с кабинетом) → client автоматически", async () => {
    const org = (
      await asUser(db, ADMIN, () =>
        db.query<{ id: string }>("select public.create_organization('Nowy','nowy-m13') as id"),
      )
    ).rows[0].id;
    await asUser(db, ADMIN, () =>
      db.query(
        `insert into public.agency_clients (organization_id, name, client_org_id, status, created_by)
         values ($1,'Nowy',$2,'active',$3)`,
        [agency, org, ADMIN],
      ),
    );
    const rel = await db.query<{ relation: string; approved_by: string }>(
      "select relation, approved_by from public.platform_managed_orgs where org_id=$1",
      [org],
    );
    expect(rel.rows[0]).toEqual({ relation: "client", approved_by: ADMIN });
    const ok = await asUser(db, PARTNER, () =>
      db.query<{ ok: boolean }>("select public.manages_organization($1) as ok", [org]),
    );
    expect(ok.rows[0].ok).toBe(true);
  });

  it("существующая связь service не превращается в client при привязке", async () => {
    const org = (
      await asUser(db, IVAN, () =>
        db.query<{ id: string }>("select public.create_organization('Barowo','barowo-m13') as id"),
      )
    ).rows[0].id;
    await db.query(
      "insert into public.platform_managed_orgs (agency_org_id, org_id, relation) values ($1,$2,'service')",
      [agency, org],
    );
    await db.query(
      "insert into public.agency_clients (organization_id, name, client_org_id) values ($1,'Barowo',$2)",
      [agency, org],
    );
    const rel = await db.query<{ relation: string }>(
      "select relation from public.platform_managed_orgs where org_id=$1",
      [org],
    );
    expect(rel.rows).toEqual([{ relation: "service" }]);
  });

  it("без строки platform_managed_orgs агентство не управляет организацией (agency_clients — не источник)", async () => {
    const org = (
      await asUser(db, ADMIN, () =>
        db.query<{ id: string }>("select public.create_organization('Bez','bez-m13') as id"),
      )
    ).rows[0].id;
    await db.query(
      "insert into public.agency_clients (organization_id, name, client_org_id) values ($1,'Bez',$2)",
      [agency, org],
    );
    await db.query("delete from public.platform_managed_orgs where org_id=$1", [org]);
    const ok = await asUser(db, PARTNER, () =>
      db.query<{ ok: boolean }>("select public.manages_organization($1) as ok", [org]),
    );
    expect(ok.rows[0].ok).toBe(false);
  });

  it("клиенты не видят и не меняют связи и журнал аудита", async () => {
    await expect(
      asUser(db, IVAN, () =>
        db.query(
          "insert into public.platform_managed_orgs (agency_org_id, org_id, relation) values ($1,$1,'client')",
          [agency],
        ),
      ),
    ).rejects.toThrow();
    await expect(
      asUser(db, IVAN, () =>
        db.query("insert into public.audit_log (action, entity) values ('x','y')"),
      ),
    ).rejects.toThrow();
    const seen = await asUser(db, IVAN, () =>
      db.query("select * from public.platform_managed_orgs"),
    );
    expect(seen.rows).toEqual([]);
  });
});

describe("миграция 0040: Barowo — отдельная экосистема", () => {
  const M40 = "20261119000040_barowo_separate.sql";
  async function setup(withOrder: boolean) {
    const db = new PGlite();
    for (const f of readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort())
      if (f < MIGRATION) await db.exec(readFileSync(path.join(dir, f), "utf8"));
    for (const id of [ADMIN, IVAN]) await createUser(db, id);
    await db.query("update auth.users set is_platform_admin=true where id=$1", [ADMIN]);
    const agency = (
      await asUser(db, ADMIN, () =>
        db.query<{ id: string }>(
          "select public.create_organization('OWO Ads','owo','agency') as id",
        ),
      )
    ).rows[0].id;
    const barowo = (
      await asUser(db, IVAN, () =>
        db.query<{ id: string }>("select public.create_organization('Barowo','barowo') as id"),
      )
    ).rows[0].id;
    const client = (
      await db.query<{ id: string }>(
        "insert into public.agency_clients (organization_id, name, client_org_id, status) values ($1,'Barowo',$2,'active') returning id",
        [agency, barowo],
      )
    ).rows[0].id;
    if (withOrder)
      await db.query(
        "insert into public.agency_orders (organization_id, client_id, title, kind, amount_grosze, period_month) values ($1,$2,'X','project',100,date_trunc('month',now())::date)",
        [agency, client],
      );
    await db.exec(readFileSync(path.join(dir, MIGRATION), "utf8"));
    await db.exec(readFileSync(path.join(dir, M40), "utf8"));
    return { db, barowo };
  }
  const count = async (db: PGlite, table: string) =>
    (await db.query<{ n: number }>(`select count(*)::int as n from public.${table}`)).rows[0].n;

  it("без заказов: связь и строка agency_clients убраны, всё записано в аудит, участники Barowo на месте", async () => {
    const { db, barowo } = await setup(false);
    expect(await count(db, "platform_managed_orgs")).toBe(0);
    expect(await count(db, "agency_clients")).toBe(0);
    const audit = await db.query<{ action: string }>(
      "select action from public.audit_log where organization_id=$1 order by id",
      [barowo],
    );
    expect(audit.rows.map((r) => r.action)).toEqual([
      "relation.create",
      "agency_client.delete",
      "relation.delete",
    ]);
    const members = await db.query<{ user_id: string; role: string }>(
      "select user_id, role from public.memberships where organization_id=$1 order by role",
      [barowo],
    );
    expect(members.rows).toContainEqual({ user_id: IVAN, role: "owner" });
    expect(members.rows.map((m) => m.user_id)).toContain(ADMIN);
    await db.close();
  });

  it("если есть заказ агентства — ничего не удаляется", async () => {
    const { db } = await setup(true);
    expect(await count(db, "platform_managed_orgs")).toBe(1);
    expect(await count(db, "agency_clients")).toBe(1);
    await db.close();
  });
});
