import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, createTestDb, createUser } from "./harness";

/**
 * Вертикаль real-estate (кабинет Адама), фаза 0/1: воронка по пресету, изоляция,
 * безопасное приглашение первого владельца. docs/architecture/ADAM_REAL_ESTATE_PHASE0.md.
 */
const ADMIN = "e5000000-0000-4000-8000-000000000001"; // админ платформы, owner OWO Ads
const PARTNER = "e5000000-0000-4000-8000-000000000002"; // admin агентства, не админ платформы
const ADAM = "e5000000-0000-4000-8000-000000000003";
const STRANGER = "e5000000-0000-4000-8000-000000000004"; // владелец другой фирмы
const SECOND = "e5000000-0000-4000-8000-000000000005";
const HASH = (c: string) => c.repeat(64);

describe("real-estate: кабинет клиента агентства", () => {
  let db: PGlite;
  let agency: string;
  let adamOrg: string;
  let otherOrg: string;
  const stages = async (org: string) =>
    (
      await db.query<{ key: string; kind: string }>(
        "select key, kind from public.pipeline_stages where organization_id=$1 order by position",
        [org],
      )
    ).rows;

  beforeAll(async () => {
    db = await createTestDb();
    for (const id of [ADMIN, PARTNER, ADAM, STRANGER, SECOND]) await createUser(db, id);
    await db.query("update auth.users set is_platform_admin=true where id=$1", [ADMIN]);
    agency = (
      await asUser(db, ADMIN, () =>
        db.query<{ id: string }>(
          "select public.create_organization('OWO Ads','owo','agency') as id",
        ),
      )
    ).rows[0].id;
    await db.query(
      "insert into public.memberships (organization_id, user_id, role) values ($1,$2,'admin')",
      [agency, PARTNER],
    );
    otherOrg = (
      await asUser(db, STRANGER, () =>
        db.query<{ id: string }>("select public.create_organization('Inna Firma','inna') as id"),
      )
    ).rows[0].id;
    // Штатный путь мастера createClientCrmAction: agency_clients → create_organization → mark_service → привязка.
    const client = (
      await asUser(db, ADMIN, () =>
        db.query<{ id: string }>(
          "insert into public.agency_clients (organization_id, name, created_by) values ($1,'Adam Nieruchomości',$2) returning id",
          [agency, ADMIN],
        ),
      )
    ).rows[0].id;
    adamOrg = await asUser(db, ADMIN, async () => {
      const id = (
        await db.query<{ id: string }>(
          "select public.create_organization('Adam Nieruchomości','adam-nieruchomosci','real-estate') as id",
        )
      ).rows[0].id;
      await db.query("select public.mark_service_membership($1)", [id]);
      await db.query(
        "update public.agency_clients set client_org_id=$3 where organization_id=$1 and id=$2",
        [agency, client, id],
      );
      return id;
    });
  });
  afterAll(() => db.close());

  it("воронка real-estate; event-services и agency не изменились", async () => {
    expect((await stages(adamOrg)).map((s) => s.key)).toEqual([
      "new",
      "contacted",
      "consultation",
      "viewing",
      "negotiation",
      "contract",
      "won",
      "lost",
      "spam",
    ]);
    expect(
      (await stages(adamOrg)).filter((s) => s.kind !== "open").map((s) => `${s.key}:${s.kind}`),
    ).toEqual(["won:won", "lost:lost", "spam:lost"]);
    expect((await stages(otherOrg)).map((s) => s.key)).toEqual([
      "new",
      "contacted",
      "offer_sent",
      "offer_accepted",
      "contract_sent",
      "contract_signed",
      "deposit_paid",
      "rejected",
      "spam",
    ]);
    expect((await stages(agency)).map((s) => s.key)).toEqual([
      "new",
      "contacted",
      "meeting",
      "offer_sent",
      "client",
      "rejected",
      "spam",
    ]);
  });

  it("кабинет связан с агентством как client; создатель — сервисный admin, не владелец", async () => {
    const rel = await db.query(
      "select relation from public.platform_managed_orgs where agency_org_id=$1 and org_id=$2",
      [agency, adamOrg],
    );
    expect(rel.rows).toEqual([{ relation: "client" }]);
    const m = await db.query(
      "select role, is_service from public.memberships where organization_id=$1 and user_id=$2",
      [adamOrg, ADMIN],
    );
    expect(m.rows).toEqual([{ role: "admin", is_service: true }]);
  });

  it("общая create_invitation по-прежнему не даёт сервисному admin пригласить владельца", async () => {
    await expect(
      asUser(db, ADMIN, () =>
        db.query("select public.create_invitation($1,$2,'owner')", [adamOrg, HASH("a")]),
      ),
    ).rejects.toThrow(/only owner invites owner/);
  });

  it("приглашение владельца: только админ платформы, только связанная организация", async () => {
    await expect(
      asUser(db, PARTNER, () =>
        db.query("select public.create_client_owner_invitation($1,$2,$3)", [
          agency,
          adamOrg,
          HASH("b"),
        ]),
      ),
    ).rejects.toThrow(/not allowed/);
    await expect(
      asUser(db, ADMIN, () =>
        db.query("select public.create_client_owner_invitation($1,$2,$3)", [
          agency,
          otherOrg,
          HASH("b"),
        ]),
      ),
    ).rejects.toThrow(/not a client organization/);
    await expect(
      asUser(db, STRANGER, () =>
        db.query("select public.create_client_owner_invitation($1,$2,$3)", [
          otherOrg,
          adamOrg,
          HASH("b"),
        ]),
      ),
    ).rejects.toThrow(/not allowed/);
  });

  it("повторная выдача отзывает прежнюю ссылку; отозванная не принимается", async () => {
    await asUser(db, ADMIN, () =>
      db.query("select public.create_client_owner_invitation($1,$2,$3)", [
        agency,
        adamOrg,
        HASH("c"),
      ]),
    );
    await asUser(db, ADMIN, () =>
      db.query("select public.create_client_owner_invitation($1,$2,$3)", [
        agency,
        adamOrg,
        HASH("d"),
      ]),
    );
    const inv = await db.query<{ token_hash: string; revoked: boolean; days: number }>(
      `select token_hash, revoked_at is not null as revoked, round(extract(epoch from expires_at - created_at)/86400)::int as days
       from public.invitations where organization_id=$1 and role='owner' order by created_at`,
      [adamOrg],
    );
    expect(inv.rows.map((r) => [r.token_hash[0], r.revoked, r.days])).toEqual([
      ["c", true, 7],
      ["d", false, 7],
    ]);
    await expect(
      asUser(db, ADAM, () => db.query("select public.accept_invitation($1)", [HASH("c")])),
    ).rejects.toThrow(/invitation invalid/);
  });

  it("Адам принимает ссылку → owner, не сервисный; сервисный доступ OWO остаётся; аудит без токена", async () => {
    await asUser(db, ADAM, () => db.query("select public.accept_invitation($1)", [HASH("d")]));
    const members = await db.query<{ user_id: string; role: string; is_service: boolean }>(
      "select user_id, role, is_service from public.memberships where organization_id=$1 order by role, user_id",
      [adamOrg],
    );
    expect(members.rows).toContainEqual({ user_id: ADAM, role: "owner", is_service: false });
    expect(members.rows).toContainEqual({ user_id: ADMIN, role: "admin", is_service: true });
    await expect(
      asUser(db, SECOND, () => db.query("select public.accept_invitation($1)", [HASH("d")])),
    ).rejects.toThrow(/invitation invalid/);
    const audit = await db.query<{ action: string; blob: string }>(
      "select action, coalesce(note,'') || coalesce(entity_id,'') as blob from public.audit_log where organization_id=$1 and action like 'owner_invitation.%' order by id",
      [adamOrg],
    );
    expect(audit.rows.map((r) => r.action)).toEqual([
      "owner_invitation.create",
      "owner_invitation.create",
      "owner_invitation.accept",
    ]);
    expect(audit.rows.some((r) => r.blob.includes("dddd"))).toBe(false);
  });

  it("после появления владельца новую ссылку владельца выдать нельзя; статус это показывает", async () => {
    await expect(
      asUser(db, ADMIN, () =>
        db.query("select public.create_client_owner_invitation($1,$2,$3)", [
          agency,
          adamOrg,
          HASH("e"),
        ]),
      ),
    ).rejects.toThrow(/owner exists/);
    const st = await asUser(db, ADMIN, () =>
      db.query<{ has_owner: boolean; pending_expires_at: string | null }>(
        "select * from public.client_owner_status($1,$2)",
        [agency, adamOrg],
      ),
    );
    expect(st.rows).toEqual([{ has_owner: true, pending_expires_at: null }]);
  });

  it("изоляция: Адам не видит заявки и воронку другой фирмы и кабинет агентства", async () => {
    await db.query(
      "insert into public.leads (organization_id, client_name, phone_e164, stage_key) values ($1,'Obcy klient','+48500000001','new')",
      [otherOrg],
    );
    const leads = await asUser(db, ADAM, () =>
      db.query<{ n: number }>(
        "select count(*)::int as n from public.leads where organization_id <> $1",
        [adamOrg],
      ),
    );
    expect(leads.rows[0].n).toBe(0);
    const foreignStages = await asUser(db, ADAM, () =>
      db.query<{ n: number }>(
        "select count(*)::int as n from public.pipeline_stages where organization_id=$1",
        [agency],
      ),
    );
    expect(foreignStages.rows[0].n).toBe(0);
    const clients = await asUser(db, ADAM, () =>
      db.query<{ n: number }>("select count(*)::int as n from public.agency_clients"),
    );
    expect(clients.rows[0].n).toBe(0);
  });
});
