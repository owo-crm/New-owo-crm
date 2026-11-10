import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, createTestDb, createUser } from "./harness";
import { normalizeLead } from "@/lib/leads/ingest";
const USER_A = "31000000-0000-4000-8000-000000000001";
const USER_B = "31000000-0000-4000-8000-000000000002";
let db: PGlite;
let orgA: string;
let orgB: string;
beforeAll(async () => {
  db = await createTestDb();
  for (const id of [USER_A, USER_B]) await createUser(db, id);
  for (const [index, user] of [USER_A, USER_B].entries()) {
    const result = await asUser(db, user, () =>
      db.query<{ id: string }>(`select public.create_organization('Test firma',$1) as id`, [
        `ingest-${index}`,
      ]),
    );
    if (index === 0) orgA = result.rows[0].id;
    else orgB = result.rows[0].id;
  }
});
afterAll(async () => db.close());
async function ingest(user: string, org: string, phone = "600100200", email = "anna@example.com") {
  return asUser(db, user, async () => {
    const result = await db.query<{
      result: { id: string; number: number; duplicate_ids: string[] };
    }>(`select public.ingest_lead($1,null,'Ręcznie',null,$2) as result`, [
      org,
      JSON.stringify(normalizeLead({ name: "Anna", phone, email })),
    ]);
    return result.rows[0].result;
  });
}
describe("atomic lead ingestion", () => {
  it("keeps duplicates, links both histories, excludes foreign firms/deleted/old leads", async () => {
    const first = await ingest(USER_A, orgA);
    await ingest(USER_B, orgB);
    const old = await ingest(USER_A, orgA);
    await db.query(
      `update public.leads set created_at = now() - interval '31 days' where id = $1`,
      [old.id],
    );
    const deleted = await ingest(USER_A, orgA);
    await db.query(`update public.leads set deleted_at = now() where id = $1`, [deleted.id]);
    const current = await ingest(USER_A, orgA);
    expect(current.duplicate_ids).toEqual([first.id]);
    expect(current.number).toBeGreaterThan(first.number);
    const events = await db.query<{ type: string; payload: { lead_id?: string } }>(
      `select type,payload from public.lead_events where lead_id = $1 order by type`,
      [current.id],
    );
    expect(events.rows).toEqual([
      { type: "created", payload: { source: "Ręcznie" } },
      { type: "possible_duplicate", payload: { lead_id: first.id } },
    ]);
    const reverse = await db.query(
      `select id from public.lead_events where lead_id = $1 and payload->>'lead_id' = $2`,
      [first.id, current.id],
    );
    expect(reverse.rows).toHaveLength(1);
  });
  it("matches phone OR email", async () => {
    const result = await ingest(USER_A, orgA, "601100200");
    expect(result.duplicate_ids.length).toBeGreaterThan(0);
  });
  it("rejects foreign organization and rolls back a failed insertion", async () => {
    await expect(ingest(USER_B, orgA)).rejects.toThrow(/row-level security/);
    const before = await db.query(`select id from public.leads`);
    await expect(
      asUser(db, USER_A, () =>
        db.query(
          `select public.ingest_lead($1,'ffffffff-ffff-4fff-8fff-ffffffffffff','X',null,$2)`,
          [orgA, JSON.stringify(normalizeLead({ name: "Anna", phone: "600100200" }))],
        ),
      ),
    ).rejects.toThrow(/foreign key/);
    const after = await db.query(`select id from public.leads`);
    expect(after.rows).toHaveLength(before.rows.length);
  });
});

it("search uses literal text, normalized phone digits, filters and RLS", async () => {
  await db.query(
    `update public.leads set event_date = '2027-06-12', event_city = 'Gdańsk', stage_key = 'contacted' where organization_id = $1`,
    [orgA],
  );
  const search = (user: string, org: string, query: string, stage: string | null = null) =>
    asUser(db, user, () =>
      db.query(
        `select id from public.search_leads($1,$2,$3,null,'unassigned','2027-06-01','2027-06-30')`,
        [org, query, stage],
      ),
    );
  expect((await search(USER_A, orgA, "600 100 200", "contacted")).rows.length).toBeGreaterThan(0);
  expect((await search(USER_A, orgA, "%", null)).rows).toHaveLength(0);
  expect((await search(USER_A, orgA, "Anna", "new")).rows).toHaveLength(0);
  expect((await search(USER_B, orgA, "Anna")).rows).toHaveLength(0);
});

async function leadVersion(id: string) {
  const row = await db.query<{ updated_at: string }>(
    `select updated_at::text from public.leads where id=$1`,
    [id],
  );
  return row.rows[0].updated_at;
}
async function change(id: string, patch: Record<string, unknown>, version?: string) {
  return asUser(db, USER_A, async () => {
    const result = await db.query<{ result: { event_id: string; updated_at: string } }>(
      `select public.change_lead($1,$2,$3,$4) as result`,
      [orgA, id, version ?? (await leadVersion(id)), JSON.stringify(patch)],
    );
    return result.rows[0].result;
  });
}
it("edits and undo are atomic and restore first_response_at", async () => {
  const lead = await ingest(USER_A, orgA, "605100200", "edit@example.com");
  const result = await change(lead.id, { stage_key: "contacted", event_city: "Żółć" });
  const row = await db.query<{ first_response_at: string | null; stage_key: string }>(
    `select first_response_at,stage_key from public.leads where id=$1`,
    [lead.id],
  );
  expect(row.rows[0].first_response_at).not.toBeNull();
  await asUser(db, USER_A, () =>
    db.query(`select public.undo_lead_change($1,$2)`, [orgA, result.event_id]),
  );
  const restored = await db.query<{ first_response_at: string | null; stage_key: string }>(
    `select first_response_at,stage_key from public.leads where id=$1`,
    [lead.id],
  );
  expect(restored.rows[0]).toEqual({ first_response_at: null, stage_key: "new" });
  const events = await db.query(
    `select type from public.lead_events where lead_id=$1 and type='restored'`,
    [lead.id],
  );
  expect(events.rows).toHaveLength(1);
  await expect(
    asUser(db, USER_A, () =>
      db.query(`select public.undo_lead_change($1,$2)`, [orgA, result.event_id]),
    ),
  ).rejects.toThrow(/lead changed/);
});
it("rejects stale versions, forbidden fields and undo after newer changes", async () => {
  const lead = await ingest(USER_A, orgA, "606100200", "conflict@example.com");
  const version = await leadVersion(lead.id);
  const first = await change(lead.id, { client_name: "Nowe imię" }, version);
  await expect(change(lead.id, { event_city: "Hacked" }, version)).rejects.toThrow(/lead changed/);
  await expect(change(lead.id, { organization_id: orgB })).rejects.toThrow(/invalid patch/);
  await change(lead.id, { event_city: "Gdynia" });
  await expect(
    asUser(db, USER_A, () =>
      db.query(`select public.undo_lead_change($1,$2)`, [orgA, first.event_id]),
    ),
  ).rejects.toThrow(/lead changed/);
});
it("does not allow foreign edits, expired undo or undo by another actor", async () => {
  const lead = await ingest(USER_A, orgA, "607100200", "undo@example.com");
  const result = await change(lead.id, { event_city: "Sopot" });
  await expect(
    asUser(db, USER_B, () =>
      db.query(`select public.change_lead($1,$2,$3,$4)`, [
        orgA,
        lead.id,
        result.updated_at,
        JSON.stringify({ event_city: "Hacked" }),
      ]),
    ),
  ).rejects.toThrow(/lead not found/);
  await expect(
    asUser(db, USER_B, () =>
      db.query(`select public.undo_lead_change($1,$2)`, [orgA, result.event_id]),
    ),
  ).rejects.toThrow(/undo expired/);
  await db.query(
    `update public.lead_events set created_at=now()-interval '9 seconds' where id=$1`,
    [result.event_id],
  );
  await expect(
    asUser(db, USER_A, () =>
      db.query(`select public.undo_lead_change($1,$2)`, [orgA, result.event_id]),
    ),
  ).rejects.toThrow(/undo expired/);
});

it("every new organization has a manual channel visible only to its members", async () => {
  const own = await asUser(db, USER_A, () =>
    db.query<{ id: string }>(
      `select id from public.channels where organization_id=$1 and type='manual'`,
      [orgA],
    ),
  );
  expect(own.rows).toHaveLength(1);
  const foreign = await asUser(db, USER_B, () =>
    db.query(`select id from public.channels where id=$1`, [own.rows[0].id]),
  );
  expect(foreign.rows).toHaveLength(0);
});

it("email/name queries with digits do not match unrelated phone digits", async () => {
  const lead = await ingest(USER_A, orgA, "609999999", "digit1@example.com");
  await db.query(`update public.leads set client_name='Client 1' where id=$1`, [lead.id]);
  for (const query of ["digit1@example.com", "Client 1"]) {
    const result = await asUser(db, USER_A, () =>
      db.query<{ id: string }>(`select id from public.search_leads($1,$2)`, [orgA, query]),
    );
    expect(result.rows).toEqual([{ id: lead.id }]);
  }
  const phone = await asUser(db, USER_A, () =>
    db.query<{ id: string }>(`select id from public.search_leads($1,'609 999 999')`, [orgA]),
  );
  expect(phone.rows).toEqual([{ id: lead.id }]);
});
