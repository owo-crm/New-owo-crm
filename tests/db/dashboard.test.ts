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
    `insert into public.leads (organization_id,client_name,email,event_date,stage_key,created_at,first_response_at,deleted_at,next_contact_at) values
 ($1,'Waiting','waiting@example.com','2027-06-12','new','2026-09-30T22:10:00Z',null,null,null),
 ($1,'Responded','responded@example.com','2027-06-12','contacted','2026-09-30T22:00:00Z','2026-09-30T22:05:00Z',null,'2026-10-01T09:00:00Z'),
 ($1,'Signed','signed@example.com','2027-05-01','contract_signed','2026-09-30T22:00:00Z','2026-09-30T22:01:00Z',null,null),
 ($1,'Spam','spam@example.com','2027-06-19','spam','2026-09-30T21:59:00Z',null,null,null),
 ($1,'Deleted','deleted@example.com','2027-06-26','new',now(),null,now(),null),
 ($2,'Foreign','foreign@example.com','2027-07-03','new',now(),null,null,null)`,
    [orgA, orgB],
  );
});
afterAll(async () => db.close());

type Queue = {
  waiting_count: number;
  response_minutes: number | null;
  month_leads: number;
  tasks_count: number;
  waiting: { client_name: string }[];
  tasks: { client_name: string }[];
  upcoming: { client_name: string; confirmed: boolean }[];
};
const queue = (user: string, org: string, now = "2026-10-01T12:00:00Z") =>
  asUser(db, user, () =>
    db.query<{ data: Queue }>(`select public.work_queue($1,$2,$3) as data`, [org, user, now]),
  );

it("kolejka pomija zamknięte, usunięte i cudze leady; miesiąc liczy się po Warszawie", async () => {
  const { data } = (await queue(A, orgA)).rows[0];
  expect(data).toMatchObject({
    waiting_count: 1,
    // Średnia z dwóch odpowiedzi: 5 i 1 minuta.
    response_minutes: 3,
    // 22:00 UTC to już 1 października w Warszawie; 21:59 UTC (Spam) — jeszcze wrzesień.
    month_leads: 3,
    tasks_count: 1,
    waiting: [{ client_name: "Waiting" }],
    tasks: [{ client_name: "Responded" }],
  });
  // Nadchodzące wydarzenia: podpisana umowa jest potwierdzona, reszta wstępna; spam i usunięte wypadają.
  expect(data.upcoming).toEqual([
    {
      id: expect.any(String),
      client_name: "Signed",
      event_date: "2027-05-01",
      event_type: null,
      event_city: null,
      confirmed: true,
    },
    {
      id: expect.any(String),
      client_name: "Waiting",
      event_date: "2027-06-12",
      event_type: null,
      event_city: null,
      confirmed: false,
    },
    {
      id: expect.any(String),
      client_name: "Responded",
      event_date: "2027-06-12",
      event_type: null,
      event_city: null,
      confirmed: false,
    },
  ]);
});

it("kolejka nie pokazuje niczego z cudzej firmy", async () => {
  const { data } = (await queue(B, orgA)).rows[0];
  expect(data).toMatchObject({
    waiting_count: 0,
    month_leads: 0,
    tasks_count: 0,
    waiting: [],
    upcoming: [],
  });
});

it("kalendarz pokazuje zajęte terminy z oznaczeniem potwierdzenia, bez cudzych", async () => {
  const mine = await asUser(db, A, () =>
    db.query<{ client_name: string; confirmed: boolean; event_date: string }>(
      `select client_name, confirmed, event_date::text from public.calendar_events($1,'2027-01-01','2027-12-31')`,
      [orgA],
    ),
  );
  expect(mine.rows).toEqual([
    { client_name: "Signed", confirmed: true, event_date: "2027-05-01" },
    { client_name: "Responded", confirmed: false, event_date: "2027-06-12" },
    { client_name: "Waiting", confirmed: false, event_date: "2027-06-12" },
  ]);
  const foreign = await asUser(db, B, () =>
    db.query(`select * from public.calendar_events($1,'2027-01-01','2027-12-31')`, [orgA]),
  );
  expect(foreign.rows).toHaveLength(0);
});
