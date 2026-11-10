import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDb, createUser as addUser, asUser } from "./harness";

let db: PGlite;
const IVAN = "10000000-0000-4000-8000-000000000001";
const ARTEM = "10000000-0000-4000-8000-000000000002";
const OBCY = "10000000-0000-4000-8000-000000000003";
const KLIENT = "10000000-0000-4000-8000-000000000004";
const hash = (s: string) =>
  s
    .padStart(64, "0")
    .slice(-64)
    .replace(/[^0-9a-f]/g, "a");
let org: string;
let other: string;

beforeAll(async () => {
  db = await createTestDb();
  for (const id of [IVAN, ARTEM, OBCY, KLIENT]) await addUser(db, id);
  org = await asUser(
    db,
    IVAN,
    async () =>
      (await db.query<{ id: string }>("select public.create_organization('Barowo','barowo') as id"))
        .rows[0].id,
  );
  other = await asUser(
    db,
    OBCY,
    async () =>
      (await db.query<{ id: string }>("select public.create_organization('Obca','obca') as id"))
        .rows[0].id,
  );
});
afterAll(() => db.close());

async function invite(by: string, organization: string, token: string, role = "member") {
  return asUser(db, by, () =>
    db.query("select public.create_invitation($1,$2,$3::public.member_role,$4)", [
      organization,
      hash(token),
      role,
      "test",
    ]),
  );
}

describe("zaproszenia i role", () => {
  it("zaprasza tylko owner/admin; owner tylko owner", async () => {
    await expect(invite(OBCY, org, "a1")).rejects.toMatchObject({ code: "42501" });
    await expect(invite(IVAN, org, "a2", "owner")).resolves.toBeTruthy();
    await invite(IVAN, org, "b1");
    await asUser(db, ARTEM, () => db.query("select public.accept_invitation($1)", [hash("b1")]));
    expect(
      (
        await db.query<{ n: number }>(
          "select count(*)::int n from public.memberships where organization_id=$1",
          [org],
        )
      ).rows[0].n,
    ).toBe(2);
    // участник (member) приглашать не может
    await expect(invite(ARTEM, org, "c1")).rejects.toMatchObject({ code: "42501" });
  });

  it("zaproszenie jest jednorazowe i wygasa", async () => {
    await invite(IVAN, org, "d1");
    await asUser(db, KLIENT, () => db.query("select public.accept_invitation($1)", [hash("d1")]));
    await expect(
      asUser(db, OBCY, () => db.query("select public.accept_invitation($1)", [hash("d1")])),
    ).rejects.toMatchObject({ code: "22023" });
    await invite(IVAN, org, "e1");
    await db.query(
      "update public.invitations set expires_at = now() - interval '1 day' where token_hash=$1",
      [hash("e1")],
    );
    await expect(
      asUser(db, OBCY, () => db.query("select public.accept_invitation($1)", [hash("e1")])),
    ).rejects.toMatchObject({ code: "22023" });
    await invite(IVAN, org, "f1");
    // token_hash не виден даже админу фирмы (нет grant на колонку) — id берём как сервис.
    const id = (
      await db.query<{ id: string }>("select id from public.invitations where token_hash=$1", [
        hash("f1"),
      ])
    ).rows[0].id;
    await asUser(db, IVAN, () => db.query("select public.revoke_invitation($1,$2)", [org, id]));
    await expect(
      asUser(db, OBCY, () => db.query("select public.accept_invitation($1)", [hash("f1")])),
    ).rejects.toMatchObject({ code: "22023" });
  });

  it("rolę zmienia tylko owner i nie może zostać bez właściciela", async () => {
    await expect(
      asUser(db, ARTEM, () =>
        db.query("select public.set_member_role($1,$2,'admin')", [org, ARTEM]),
      ),
    ).rejects.toMatchObject({ code: "42501" });
    await asUser(db, IVAN, () =>
      db.query("select public.set_member_role($1,$2,'admin')", [org, ARTEM]),
    );
    await expect(
      asUser(db, IVAN, () =>
        db.query("select public.set_member_role($1,$2,'member')", [org, IVAN]),
      ),
    ).rejects.toMatchObject({ code: "22023" });
  });

  it("zespół widzą tylko członkowie firmy", async () => {
    const mine = await asUser(db, ARTEM, () =>
      db.query("select * from public.team_members($1)", [org]),
    );
    expect(mine.rows.length).toBe(3);
    const foreign = await asUser(db, ARTEM, () =>
      db.query("select * from public.team_members($1)", [other]),
    );
    expect(foreign.rows).toHaveLength(0);
    // RLS: участник без роли admin не видит приглашений…
    const invites = await asUser(db, KLIENT, () =>
      db.query("select id, role from public.invitations where organization_id=$1", [org]),
    );
    expect(invites.rows).toHaveLength(0);
    // …а хэш токена закрыт для всех ролей, даже для владельца.
    await expect(
      asUser(db, IVAN, () =>
        db.query("select token_hash from public.invitations where organization_id=$1", [org]),
      ),
    ).rejects.toThrow(/permission denied/);
  });
});
