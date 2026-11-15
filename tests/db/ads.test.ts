import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, createTestDb, createUser } from "./harness";

/** Реклама: расходы по кампаниям ↔ заявки CRM по utm_campaign, изоляция фирм. */
const OWNER = "f0000000-0000-4000-8000-000000000001";
const OTHER = "f0000000-0000-4000-8000-000000000002";
let db: PGlite;
let org: string;
let account: string;

beforeAll(async () => {
  db = await createTestDb();
  await createUser(db, OWNER);
  await createUser(db, OTHER);
  org = (
    await asUser(db, OWNER, () =>
      db.query<{ id: string }>("select public.create_organization('Foto','foto-ads') as id"),
    )
  ).rows[0].id;
  account = (
    await asUser(db, OWNER, () =>
      db.query<{ id: string }>(
        "insert into public.ad_accounts (organization_id, platform, external_id, name) values ($1,'meta','act_1','Meta Foto') returning id",
        [org],
      ),
    )
  ).rows[0].id;
  await asUser(db, OWNER, () =>
    db.query(
      `insert into public.ad_spend (organization_id, ad_account_id, date, campaign_id, campaign_name, spend_grosze, clicks, platform_leads)
       values ($1,$2,'2026-11-03','c1','Wesela jesień',30000,120,12), ($1,$2,'2026-11-04','c1','Wesela jesień',20000,80,8),
              ($1,$2,'2026-11-04','c2','Urodziny',10000,40,2)`,
      [org, account],
    ),
  );
  for (const [name, campaign, stage] of [
    ["A", "wesela jesień", "new"],
    ["B", "Wesela jesień", "deposit_paid"],
    ["C", "c2", "new"],
    ["D", "inna", "new"],
  ])
    await db.query(
      `insert into public.leads (organization_id, client_name, email, stage_key, utm, created_at)
       values ($1,$2,$3,$4,$5,'2026-11-05T10:00:00Z')`,
      [org, name, `${name.toLowerCase()}@x.pl`, stage, JSON.stringify({ campaign })],
    );
});
afterAll(() => db.close());

describe("отчёт по рекламе", () => {
  it("расход, заявки CRM и клиенты по кампаниям (по названию или ID)", async () => {
    const d = (
      await asUser(db, OWNER, () =>
        db.query<{
          d: {
            spend_grosze: number;
            crm_leads: number;
            won: number;
            unmatched_leads: number;
            campaigns: {
              campaign_name: string;
              spend_grosze: number;
              crm_leads: number;
              won: number;
            }[];
          };
        }>("select public.ads_report($1,'2026-11-01','2026-12-01') as d", [org]),
      )
    ).rows[0].d;
    expect(Number(d.spend_grosze)).toBe(60000);
    expect(
      d.campaigns.map((c) => [
        c.campaign_name,
        Number(c.spend_grosze),
        Number(c.crm_leads),
        Number(c.won),
      ]),
    ).toEqual([
      ["Wesela jesień", 50000, 2, 1],
      ["Urodziny", 10000, 1, 0],
    ]);
    expect(Number(d.unmatched_leads)).toBe(1);
  });

  it("чужая фирма ничего не видит и не пишет", async () => {
    await asUser(db, OTHER, async () => {
      expect((await db.query("select * from public.ad_accounts")).rows).toEqual([]);
      expect((await db.query("select * from public.ad_spend")).rows).toEqual([]);
      await expect(
        db.query(
          "insert into public.ad_accounts (organization_id, platform, name) values ($1,'manual','X')",
          [org],
        ),
      ).rejects.toThrow();
    });
  });
});
