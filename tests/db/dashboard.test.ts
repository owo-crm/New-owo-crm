import { afterAll, beforeAll, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, createTestDb, createUser } from "./harness";
const A = "61000000-0000-4000-8000-000000000001";
const B = "61000000-0000-4000-8000-000000000002";
let db: PGlite;
let orgA: string;
let orgB: string;
beforeAll(async () => {
  db = await createTestDb();
  await createUser(db, A);
  await createUser(db, B);
  orgA = (
    await asUser(db, A, () =>
      db.query<{ id: string }>(`select public.create_organization('Firma A','dashboard-a') as id`),
    )
  ).rows[0].id;
  orgB = (
    await asUser(db, B, () =>
      db.query<{ id: string }>(`select public.create_organization('Firma B','dashboard-b') as id`),
    )
  ).rows[0].id;
  await db.query(
    `insert into public.leads (organization_id,client_name,email,event_date,stage_key,created_at,first_response_at,deleted_at) values
 ($1,'Waiting','waiting@example.com','2027-06-12','new','2026-09-30T22:10:00Z',null,null),
 ($1,'Responded','responded@example.com','2027-06-12','contacted','2026-09-30T22:00:00Z','2026-09-30T22:05:00Z',null),
 ($1,'Spam','spam@example.com','2027-06-19','spam','2026-09-30T21:59:00Z',null,null),
 ($1,'Deleted','deleted@example.com','2027-06-26','new',now(),null,now()),
 ($2,'Foreign','foreign@example.com','2027-07-03','new',now(),null,null)`,
    [orgA, orgB],
  );
});
afterAll(async () => db.close());
it("dashboard excludes closed/deleted/foreign leads and uses Warsaw month boundaries", async () => {
  const result = await asUser(db, A, () =>
    db.query<{
      data: {
        waiting_count: number;
        response_minutes: number;
        month_leads: number;
        waiting: { client_name: string }[];
        inquiries: Record<string, string>;
      };
    }>(`select public.lead_dashboard($1,2027,'2026-10-01T12:00:00Z') as data`, [orgA]),
  );
  expect(result.rows[0].data).toMatchObject({
    waiting_count: 1,
    response_minutes: 5,
    month_leads: 2,
    waiting: [{ client_name: "Waiting" }],
    inquiries: { "2027-06-12": "inquiry" },
  });
});
it("dashboard never reveals aggregates or dates for a foreign organization", async () => {
  const result = await asUser(db, B, () =>
    db.query<{
      data: {
        waiting_count: number;
        month_leads: number;
        waiting: unknown[];
        inquiries: Record<string, string>;
      };
    }>(`select public.lead_dashboard($1,2027) as data`, [orgA]),
  );
  expect(result.rows[0].data).toMatchObject({
    waiting_count: 0,
    month_leads: 0,
    waiting: [],
    inquiries: {},
  });
});
