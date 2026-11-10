import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDb } from "./harness";
import { TYPE_PARSERS, asUser, type Database } from "@/lib/db/core";
import { migrate } from "@/lib/db/migrate";
import {
  authenticate,
  createPasswordReset,
  createSession,
  createUser,
  deleteSession,
  getSessionUser,
  listOrganizations,
  resetPassword,
  EmailTakenError,
} from "@/lib/auth/repository";
import { createIngestRepository } from "@/lib/leads/repository";
import path from "node:path";

let pg: PGlite;
let db: Database;
beforeAll(async () => {
  pg = await createTestDb();
  const parsers = Object.fromEntries(Object.entries(TYPE_PARSERS).map(([k, v]) => [Number(k), v]));
  const wrap = (q: { query: PGlite["query"]; exec: PGlite["exec"] }) => ({
    query: (sql: string, params?: unknown[]) => q.query(sql, params, { parsers }) as never,
    exec: (sql: string) => q.exec(sql),
  });
  db = { ...wrap(pg), transaction: (fn) => pg.transaction((tx) => fn(wrap(tx as never))) };
});
afterAll(() => pg.close());

describe("konta i sesje", () => {
  let userId: string;
  it("rejestracja, logowanie, sesja", async () => {
    userId = await createUser(db, {
      email: "Ivan@Barowo.com",
      password: "bardzo-tajne-1",
      fullName: "Ivan",
    });
    await expect(
      createUser(db, { email: "ivan@barowo.com", password: "x".repeat(10), fullName: "X" }),
    ).rejects.toBeInstanceOf(EmailTakenError);
    expect(await authenticate(db, "ivan@barowo.com", "zle-haslo-123")).toBeNull();
    expect(await authenticate(db, "nikt@barowo.com", "bardzo-tajne-1")).toBeNull();
    expect(await authenticate(db, " IVAN@barowo.com", "bardzo-tajne-1")).toBe(userId);
    const { token } = await createSession(db, userId, "test");
    expect((await getSessionUser(db, token))?.email).toBe("ivan@barowo.com");
    await deleteSession(db, token);
    expect(await getSessionUser(db, token)).toBeNull();
  });
  it("reset hasła jest jednorazowy i zamyka sesje", async () => {
    const { token: session } = await createSession(db, userId);
    expect(await createPasswordReset(db, "brak@x.pl")).toBeNull();
    const token = (await createPasswordReset(db, "ivan@barowo.com"))!;
    expect(await resetPassword(db, token, "nowe-haslo-123")).toBe(userId);
    expect(await resetPassword(db, token, "inne-haslo-123")).toBeNull();
    expect(await getSessionUser(db, session)).toBeNull();
    expect(await authenticate(db, "ivan@barowo.com", "nowe-haslo-123")).toBe(userId);
  });
  it("firmy przez RLS + idempotentny lead z submission_id", async () => {
    const orgId = await asUser(
      db,
      userId,
      async (tx) =>
        (
          await tx.query<{ id: string }>(
            "select public.create_organization('Barowo','barowo','event-services') as id",
          )
        ).rows[0].id,
    );
    const other = await createUser(db, {
      email: "obcy@x.pl",
      password: "y".repeat(10),
      fullName: "Obcy",
    });
    expect(await listOrganizations(db, userId)).toHaveLength(1);
    expect(await listOrganizations(db, other)).toHaveLength(0);
    const channel = (
      await db.query<{ id: string }>("select id from public.channels where organization_id=$1", [
        orgId,
      ])
    ).rows[0].id;
    const ctx = {
      organizationId: orgId,
      channelId: channel,
      sourceLabel: "Strona",
      consentAt: null,
    };
    const lead = { client_name: "Anna", phone_e164: "+48500100200", message: "" };
    const first = await createIngestRepository(db, "sub-123456").saveLead(ctx, lead as never);
    const again = await createIngestRepository(db, "sub-123456").saveLead(ctx, lead as never);
    expect(again.id).toBe(first.id);
    const count = await db.query<{ n: number }>(
      "select count(*) as n from public.leads where organization_id=$1",
      [orgId],
    );
    expect(count.rows[0].n).toBe(1);
    const version = await db.query<{ updated_at: string }>(
      "select updated_at from public.leads where id=$1",
      [first.id],
    );
    expect(version.rows[0].updated_at).toMatch(/^\d{4}-\d\d-\d\dT.*[+-]\d\d:\d\d$/);
    const changed = await asUser(db, userId, (tx) =>
      tx.query<{ r: { event_id: string } }>("select public.change_lead($1,$2,$3,$4) as r", [
        orgId,
        first.id,
        version.rows[0].updated_at,
        { stage_key: "contacted" },
      ]),
    );
    expect(changed.rows[0].r.event_id).toBeTruthy();
    await expect(
      asUser(db, userId, (tx) =>
        tx.query("select public.change_lead($1,$2,$3,$4)", [
          orgId,
          first.id,
          version.rows[0].updated_at,
          { venue: "X" },
        ]),
      ),
    ).rejects.toMatchObject({ code: "40001" });
    await asUser(db, userId, (tx) =>
      tx.query("select public.undo_lead_change($1,$2)", [orgId, changed.rows[0].r.event_id]),
    );
    const stage = await db.query<{ stage_key: string }>(
      "select stage_key from public.leads where id=$1",
      [first.id],
    );
    expect(stage.rows[0].stage_key).toBe("new");
  });
  it("migrator nie stosuje migracji dwa razy", async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    const fresh = new PGlite();
    const q = {
      query: (s: string, p?: unknown[]) => fresh.query(s, p) as never,
      exec: (s: string) => fresh.exec(s),
    };
    const clean: Database = {
      ...q,
      transaction: (fn) =>
        fresh.transaction((tx) =>
          fn({ query: (s, p) => tx.query(s, p) as never, exec: (s) => tx.exec(s) }),
        ),
    };
    const dir = path.resolve(__dirname, "../../db/migrations");
    expect((await migrate(clean, dir)).length).toBe(16);
    expect(await migrate(clean, dir)).toEqual([]);
    await fresh.close();
  });
});

describe("bootstrap pierwszego administratora", () => {
  it("tworzy admina i firmę Barowo tylko w pustej bazie", async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    const { bootstrapAdmin } = await import("@/lib/db/bootstrap");
    const fresh = new PGlite();
    const wrap = (q: { query: PGlite["query"]; exec: PGlite["exec"] }) => ({
      query: (s: string, p?: unknown[]) => q.query(s, p) as never,
      exec: (s: string) => q.exec(s),
    });
    const clean: Database = {
      ...wrap(fresh),
      transaction: (fn) => fresh.transaction((tx) => fn(wrap(tx as never))),
    };
    await migrate(clean, path.resolve(__dirname, "../../db/migrations"));
    const env = {
      BOOTSTRAP_ADMIN_EMAIL: "Ivan@Barowo.com",
      BOOTSTRAP_ADMIN_PASSWORD: "dlugie-haslo-1",
      BOOTSTRAP_ORG_EMAIL: "barowo.pl@gmail.com",
    };
    await expect(
      bootstrapAdmin(clean, { ...env, BOOTSTRAP_ADMIN_PASSWORD: "krotkie" }, () => {}),
    ).rejects.toThrow(/10 znaków/);
    const first = await bootstrapAdmin(clean, env, () => {});
    expect(first?.org).toBeTruthy();
    expect(await bootstrapAdmin(clean, env, () => {})).toBeNull();
    const org = await clean.query<{ document_engine: string; slug: string }>(
      "select document_engine, slug from public.organizations",
    );
    expect(org.rows).toEqual([{ document_engine: "barowo", slug: "barowo" }]);
    expect(await authenticate(clean, "ivan@barowo.com", "dlugie-haslo-1")).toBe(first?.userId);
    await fresh.close();
  });
});
