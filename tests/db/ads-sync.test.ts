import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDb, createUser, asUser } from "./harness";
import { TYPE_PARSERS, type Database } from "@/lib/db/core";
import { syncAdAccounts } from "@/lib/ads/sync";

/** Синхронизация расходов Meta/Google без сети: ответы платформ подменены. */
const OWNER = "f1000000-0000-4000-8000-000000000001";
let pg: PGlite;
let db: Database;
let org: string;

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

const fakeFetch: typeof fetch = async (input) => {
  const url = String(input);
  if (url.includes("graph.facebook.com"))
    return json({
      data: [
        {
          date_start: "2026-11-10",
          campaign_id: "m1",
          campaign_name: "Wesela",
          spend: "123.45",
          impressions: "1000",
          clicks: "40",
          actions: [{ action_type: "lead", value: "6" }],
        },
      ],
    });
  if (url.includes("oauth2.googleapis.com")) return json({ access_token: "tok" });
  if (url.includes("googleads.googleapis.com"))
    return json([
      {
        results: [
          {
            campaign: { id: "777", name: "Search PL" },
            segments: { date: "2026-11-10" },
            metrics: { costMicros: "45670000", impressions: "300", clicks: "25", conversions: 3 },
          },
        ],
      },
    ]);
  return json({ error: { message: "nope" } }, 400);
};

beforeAll(async () => {
  pg = await createTestDb();
  const parsers = Object.fromEntries(Object.entries(TYPE_PARSERS).map(([k, v]) => [Number(k), v]));
  const wrap = (x: { query: PGlite["query"] }) => ({
    query: (sql: string, params?: unknown[]) => x.query(sql, params, { parsers }) as never,
  });
  db = { ...wrap(pg), transaction: (fn) => pg.transaction((tx) => fn(wrap(tx as never))) };
  await createUser(pg, OWNER);
  org = (
    await asUser(pg, OWNER, () =>
      pg.query<{ id: string }>("select public.create_organization('Xyz','x-ads') as id"),
    )
  ).rows[0].id;
  await pg.query(
    "insert into public.ad_accounts (organization_id, platform, external_id, name) values ($1,'meta','act_1','M'),($1,'google','123-456-7890','G'),($1,'manual',null,'Ręcznie')",
    [org],
  );
});
afterAll(() => pg.close());

describe("синхронизация расходов", () => {
  it("без ключей ничего не делает", async () => {
    expect(await syncAdAccounts(db, {}, new Date("2026-11-11"), fakeFetch)).toMatchObject({
      skipped: true,
    });
  });

  it("Meta и Google: расходы в грошах, повтор обновляет, а не дублирует", async () => {
    const env = {
      META_ACCESS_TOKEN: "x",
      GOOGLE_ADS_DEVELOPER_TOKEN: "d",
      GOOGLE_ADS_CLIENT_ID: "c",
      GOOGLE_ADS_CLIENT_SECRET: "s",
      GOOGLE_ADS_REFRESH_TOKEN: "r",
    };
    expect(await syncAdAccounts(db, env, new Date("2026-11-11"), fakeFetch)).toEqual({
      synced: 2,
      failed: 0,
      skipped: false,
      rows: 2,
    });
    await pg.query("update public.ad_accounts set last_synced_at = null");
    await syncAdAccounts(db, env, new Date("2026-11-11"), fakeFetch);
    const rows = await pg.query<{
      campaign_name: string;
      spend_grosze: number;
      platform_leads: number;
    }>(
      "select campaign_name, spend_grosze::int, platform_leads from public.ad_spend order by campaign_name",
    );
    expect(rows.rows).toEqual([
      { campaign_name: "Search PL", spend_grosze: 4567, platform_leads: 3 },
      { campaign_name: "Wesela", spend_grosze: 12345, platform_leads: 6 },
    ]);
  });

  it("ошибка платформы пишется в аккаунт и не ломает остальные", async () => {
    await pg.query(
      "update public.ad_accounts set last_synced_at = null, external_id = 'act_bad' where platform='meta'",
    );
    const failing: typeof fetch = async (input) =>
      String(input).includes("graph.facebook.com")
        ? json({ error: { message: "Invalid token" } }, 400)
        : fakeFetch(input);
    const r = await syncAdAccounts(db, { META_ACCESS_TOKEN: "x" }, new Date("2026-11-11"), failing);
    expect(r).toMatchObject({ synced: 0, failed: 1 });
    const acc = await pg.query<{ last_error: string }>(
      "select last_error from public.ad_accounts where platform='meta'",
    );
    expect(acc.rows[0].last_error).toContain("Invalid token");
  });
});
