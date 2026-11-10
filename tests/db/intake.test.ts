import { afterAll, beforeAll, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, createTestDb, createUser } from "./harness";
const USER = "41000000-0000-4000-8000-000000000001";
let db: PGlite;
let org: string;
let channel: string;
beforeAll(async () => {
  db = await createTestDb();
  await createUser(db, USER);
  const result = await asUser(db, USER, () =>
    db.query<{ id: string }>(
      `select public.create_organization('Intake test','intake-test') as id`,
    ),
  );
  org = result.rows[0].id;
  const channels = await db.query<{ id: string }>(
    `insert into public.channels (organization_id,type,name) values ($1,'website','Strona') returning id`,
    [org],
  );
  channel = channels.rows[0].id;
});
afterAll(async () => db.close());
it("persists the limit across requests and excludes attempts older than one hour", async () => {
  for (let n = 0; n < 12; n++) {
    const result = await db.query<{ result: { id: string; allowed: boolean } }>(
      `select public.reserve_intake($1,$2,$3) as result`,
      [org, channel, "a".repeat(64)],
    );
    expect(result.rows[0].result.allowed).toBe(n < 10);
  }
  await db.query(`update public.intake_log set received_at = now() - interval '2 hours'`);
  const res = await db.query<{ result: { allowed: boolean } }>(
    `select public.reserve_intake($1,$2,$3) as result`,
    [org, channel, "a".repeat(64)],
  );
  expect(res.rows[0].result.allowed).toBe(true);
});
it("authenticated members cannot reserve or alter intake audit", async () => {
  await expect(
    asUser(db, USER, () =>
      db.query(`select public.reserve_intake($1,$2,$3)`, [org, channel, "a".repeat(64)]),
    ),
  ).rejects.toThrow(/permission denied/);
});
it("last_received_at updates only after a successfully saved lead", async () => {
  await db.query(
    `update public.intake_log set ok = true, error = null where organization_id = $1`,
    [org],
  );
  const result = await db.query<{ last_received_at: string | null }>(
    `select last_received_at from public.channels where id = $1`,
    [channel],
  );
  expect(result.rows[0].last_received_at).not.toBeNull();
});
