import { afterAll, beforeAll, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, createTestDb, createUser } from "./harness";
const A = "81000000-0000-4000-8000-000000000001",
  B = "81000000-0000-4000-8000-000000000002",
  C = "81000000-0000-4000-8000-000000000003";
let db: PGlite;
let orgA: string;
let orgB: string;
let lead: string;
beforeAll(async () => {
  db = await createTestDb();
  for (const user of [A, B, C]) await createUser(db, user);
  orgA = (
    await asUser(db, A, () =>
      db.query<{ id: string }>(`select public.create_organization('Firma A','notify-a') as id`),
    )
  ).rows[0].id;
  orgB = (
    await asUser(db, B, () =>
      db.query<{ id: string }>(`select public.create_organization('Firma B','notify-b') as id`),
    )
  ).rows[0].id;
  await db.query(
    `insert into public.memberships(organization_id,user_id,role) values($1,$2,'member')`,
    [orgA, C],
  );
  lead = (
    await db.query<{ id: string }>(
      `insert into public.leads(organization_id,client_name,email,created_at) values($1,'Anna','anna@example.com',now()-interval '16 minutes') returning id`,
      [orgA],
    )
  ).rows[0].id;
});
afterAll(async () => db.close());
async function service<T>(fn: () => Promise<T>) {
  await db.exec("set role service_role");
  try {
    return await fn();
  } finally {
    await db.exec("reset role");
  }
}
it("outbox is atomic, unique and follows connected channels and user settings", async () => {
  const rows = await db.query<{ channel: string; kind: string }>(
    `select channel,kind from public.notification_deliveries where lead_id=$1`,
    [lead],
  );
  expect(rows.rows).toEqual([
    { channel: "email", kind: "new_lead" },
    { channel: "email", kind: "new_lead" },
  ]);
  await service(() => db.query(`select public.prepare_notification_jobs()`));
  await service(() => db.query(`select public.prepare_notification_jobs()`));
  const reminders = await db.query(
    `select id from public.notification_deliveries where lead_id=$1 and kind='unanswered_15m'`,
    [lead],
  );
  expect(reminders.rows).toHaveLength(2);
  await db.query(`update public.leads set first_response_at=now() where id=$1`, [lead]);
  await service(() => db.query(`select public.prepare_notification_jobs()`));
  const skipped = await db.query<{ status: string }>(
    `select status from public.notification_deliveries where lead_id=$1 and kind='unanswered_15m'`,
    [lead],
  );
  expect(skipped.rows.every((row) => row.status === "skipped")).toBe(true);
  const old = (
    await db.query<{ id: string }>(
      `insert into public.leads(organization_id,client_name,email,created_at) values($1,'Old','old@example.com',now()-interval '3 hours') returning id`,
      [orgA],
    )
  ).rows[0].id;
  await service(() => db.query(`select public.prepare_notification_jobs()`));
  expect(
    (
      await db.query(
        `select user_id from public.notification_deliveries where lead_id=$1 and kind='unanswered_2h'`,
        [old],
      )
    ).rows,
  ).toEqual([{ user_id: A }]);
  expect(
    (
      await db.query(
        `select id from public.notification_deliveries where lead_id=$1 and kind='unanswered_15m'`,
        [old],
      )
    ).rows,
  ).toHaveLength(0);
});
it("leases prevent double claiming, reject stale completion and stop after five attempts", async () => {
  const id = (
    await db.query<{ id: string }>(
      `insert into public.leads(organization_id,client_name,email) values($1,'Retry','retry@example.com') returning id`,
      [orgA],
    )
  ).rows[0].id;
  type Job = { id: string; lease_token: string; attempts: number };
  const jobs = await service(() =>
    db.query<Job>(`select * from public.claim_notification_jobs($1)`, [id]),
  );
  expect(jobs.rows).toHaveLength(2);
  expect(
    (await service(() => db.query(`select * from public.claim_notification_jobs($1)`, [id]))).rows,
  ).toHaveLength(0);
  const first = jobs.rows[0];
  await db.query(
    `update public.notification_deliveries set status='skipped' where lead_id=$1 and id<>$2`,
    [id, first.id],
  );
  await db.query(
    `update public.notification_deliveries set locked_at=now()-interval '6 minutes' where id=$1`,
    [first.id],
  );
  let job = (
    await service(() => db.query<Job>(`select * from public.claim_notification_jobs($1)`, [id]))
  ).rows[0];
  expect(job.attempts).toBe(2);
  expect(job.lease_token).not.toBe(first.lease_token);
  expect(
    (
      await service(() =>
        db.query<{ ok: boolean }>(`select public.finish_notification_job($1,$2,'sent') as ok`, [
          first.id,
          first.lease_token,
        ]),
      )
    ).rows[0].ok,
  ).toBe(false);
  for (let attempt = 2; attempt <= 5; attempt++) {
    await service(() =>
      db.query(`select public.finish_notification_job($1,$2,'failed','mock')`, [
        job.id,
        job.lease_token,
      ]),
    );
    if (attempt < 5) {
      await db.query(
        `update public.notification_deliveries set next_attempt_at=now() where id=$1`,
        [job.id],
      );
      job = (
        await service(() => db.query<Job>(`select * from public.claim_notification_jobs($1)`, [id]))
      ).rows[0];
      expect(job.attempts).toBe(attempt + 1);
    }
  }
  expect(
    (
      await db.query<{ status: string }>(
        `select status from public.notification_deliveries where id=$1`,
        [first.id],
      )
    ).rows[0].status,
  ).toBe("dead");
  expect(
    (await service(() => db.query(`select * from public.claim_notification_jobs($1)`, [id]))).rows,
  ).toHaveLength(0);
});
it("history imports do not enqueue messages and intake audit is pruned after 30 days", async () => {
  const imported = (
    await db.query<{ id: string }>(
      `insert into public.leads(organization_id,client_name,email,legacy_uid) values($1,'History','history@example.com','legacy-1') returning id`,
      [orgA],
    )
  ).rows[0].id;
  expect(
    (await db.query(`select id from public.notification_deliveries where lead_id=$1`, [imported]))
      .rows,
  ).toHaveLength(0);
  const channel = (
    await db.query<{ id: string }>(
      `select id from public.channels where organization_id=$1 limit 1`,
      [orgA],
    )
  ).rows[0].id;
  await db.query(
    `insert into public.intake_log(organization_id,channel_id,ok,received_at) values($1,$2,true,now()-interval '31 days')`,
    [orgA, channel],
  );
  await service(() => db.query(`select public.prepare_notification_jobs()`));
  expect(
    (await db.query(`select id from public.intake_log where received_at<now()-interval '30 days'`))
      .rows,
  ).toHaveLength(0);
});
it("tenant relationships remain enforced for server-created deliveries", async () => {
  await expect(
    db.query(
      `insert into public.notification_deliveries(organization_id,lead_id,user_id,channel,kind) values($1,$2,$3,'email','new_lead')`,
      [orgB, lead, B],
    ),
  ).rejects.toThrow(/foreign key/);
});

it("legacy RPC preserves original timestamps and edits, stays silent and forbids client calls", async () => {
  const input = JSON.stringify({
    client_name: "Imported",
    phone_e164: "+48600100123",
    email: null,
    message: "History",
  });
  const args = [
    orgA,
    "apps-script:original",
    input,
    "contacted",
    new Date(Date.now() - 20 * 60000).toISOString(),
    null,
    "Strona",
    JSON.stringify({ uid: "original" }),
  ];
  const imported = await service(() =>
    db.query<{ result: { id: string; inserted: boolean } }>(
      `select public.import_legacy_lead($1,$2,$3,$4,$5,$6,$7,$8) as result`,
      args,
    ),
  );
  expect(imported.rows[0].result.inserted).toBe(true);
  const id = imported.rows[0].result.id;
  await db.query(`update public.leads set client_name='CRM edit' where id=$1`, [id]);
  const repeated = await service(() =>
    db.query<{ result: { id: string; inserted: boolean } }>(
      `select public.import_legacy_lead($1,$2,$3,$4,$5,$6,$7,$8) as result`,
      args,
    ),
  );
  expect(repeated.rows[0].result).toEqual({ id, inserted: false });
  expect(
    (
      await db.query<{ client_name: string; first_response_at: string | null }>(
        `select client_name,first_response_at from public.leads where id=$1`,
        [id],
      )
    ).rows[0],
  ).toEqual({ client_name: "CRM edit", first_response_at: null });
  await service(() => db.query(`select public.prepare_notification_jobs()`));
  expect(
    (await db.query(`select id from public.notification_deliveries where lead_id=$1`, [id])).rows,
  ).toHaveLength(0);
  const queue = await asUser(db, A, () =>
    db.query<{ data: { waiting: { id: string }[] } }>(`select public.work_queue($1,$2) as data`, [
      orgA,
      A,
    ]),
  );
  expect(queue.rows[0].data.waiting.some((row) => row.id === id)).toBe(false);
  await expect(
    asUser(db, A, () =>
      db.query(`select public.import_legacy_lead($1,$2,$3,$4,$5,$6,$7,$8)`, args),
    ),
  ).rejects.toThrow(/permission denied/);
});
