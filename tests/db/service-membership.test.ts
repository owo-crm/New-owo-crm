import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, createTestDb, createUser } from "./harness";

// OWO Ads (админ платформы) заводит бизнес клиента, зовёт владельца и остаётся
// обслуживающим участником: виден в команде, но выгнать себя не даёт.
const AGENCY = "80000000-0000-4000-8000-000000000001";
const CLIENT = "80000000-0000-4000-8000-000000000002";
const STAFF = "80000000-0000-4000-8000-000000000003";
let db: PGlite;
let org: string;

const role = (user: string) =>
  db
    .query<{ role: string }>(
      "select role from public.memberships where organization_id=$1 and user_id=$2",
      [org, user],
    )
    .then((r) => r.rows[0]?.role ?? null);

beforeAll(async () => {
  db = await createTestDb();
  for (const id of [AGENCY, CLIENT, STAFF]) await createUser(db, id);
  await db.query("update auth.users set is_platform_admin=true where id=$1", [AGENCY]);

  org = (
    await asUser(db, AGENCY, () =>
      db.query<{ id: string }>(
        "select public.create_organization('Sopot Barber','sopot-barber') as id",
      ),
    )
  ).rows[0].id;
  await asUser(db, AGENCY, () => db.query("select public.mark_service_membership($1)", [org]));
  // Передаём владение клиенту, агентство остаётся администратором: именно в этом
  // состоянии защиту обеспечивает признак is_service, а не правило «владельца не трогать».
  await db.query(
    "insert into public.memberships (organization_id, user_id, role) values ($1,$2,'owner'), ($1,$3,'member')",
    [org, CLIENT, STAFF],
  );
  await asUser(db, AGENCY, () =>
    db.query("select public.set_member_role($1,$2,'admin')", [org, AGENCY]),
  );
});
afterAll(() => db.close());

describe("обслуживающее участие агентства", () => {
  it("видно клиенту в списке команды", async () => {
    const rows = await asUser(db, CLIENT, () =>
      db.query<{ user_id: string; is_service: boolean }>(
        "select user_id, is_service from public.team_members($1)",
        [org],
      ),
    );
    expect(rows.rows.find((r) => r.user_id === AGENCY)?.is_service).toBe(true);
    expect(rows.rows.find((r) => r.user_id === CLIENT)?.is_service).toBe(false);
  });

  it("владелец клиента не может его удалить", async () => {
    await asUser(db, CLIENT, () =>
      db.query("delete from public.memberships where organization_id=$1 and user_id=$2", [
        org,
        AGENCY,
      ]),
    );
    expect(await role(AGENCY)).toBe("admin");
  });

  it("владелец клиента не может понизить его в правах", async () => {
    await expect(
      asUser(db, CLIENT, () =>
        db.query("select public.set_member_role($1,$2,'member')", [org, AGENCY]),
      ),
    ).rejects.toThrow();
    expect(await role(AGENCY)).toBe("admin");
  });

  it("своего сотрудника клиент удаляет свободно", async () => {
    await asUser(db, CLIENT, () =>
      db.query("delete from public.memberships where organization_id=$1 and user_id=$2", [
        org,
        STAFF,
      ]),
    );
    expect(await role(STAFF)).toBeNull();
  });

  it("отметку ставит только админ платформы", async () => {
    await expect(
      asUser(db, CLIENT, () => db.query("select public.mark_service_membership($1)", [org])),
    ).rejects.toThrow();
  });
});
