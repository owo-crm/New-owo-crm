import type { Database } from "../db/core.ts";
import {
  fetchGoogleSpend,
  fetchMetaSpend,
  googleConfigured,
  metaConfigured,
  type SpendRow,
} from "./platforms.ts";

/**
 * Ежедневная синхронизация расходов (решение 046): аккаунты Meta/Google, не обновлявшиеся
 * 20+ часов, получают расходы за последние 30 дней (платформы задним числом уточняют цифры).
 * Ошибка одного аккаунта не мешает остальным — пишется в ad_accounts.last_error.
 */
export async function syncAdAccounts(
  db: Database,
  env: Record<string, string | undefined>,
  now = new Date(),
  fetchImpl: typeof fetch = fetch,
  /** Кнопка «Pobierz teraz»: только аккаунты одного бизнеса и пауза 5 минут вместо 20 часов. */
  only?: { organizationId: string },
) {
  const platforms = [
    metaConfigured(env) ? "meta" : null,
    googleConfigured(env) ? "google" : null,
  ].filter(Boolean);
  if (!platforms.length) return { synced: 0, failed: 0, skipped: true };
  const { rows: accounts } = await db.query<{
    id: string;
    organization_id: string;
    platform: "meta" | "google";
    external_id: string;
  }>(
    `select id, organization_id, platform, external_id from public.ad_accounts
     where status = 'active' and external_id is not null and platform = any($1::text[])
       and (last_synced_at is null or last_synced_at < now() - $2::interval)
       and ($3::uuid is null or organization_id = $3)
     order by last_synced_at nulls first limit 50`,
    [platforms, only ? "5 minutes" : "20 hours", only?.organizationId ?? null],
  );
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const to = day(now);
  const from = day(new Date(now.getTime() - 30 * 86_400_000));
  let synced = 0;
  let failed = 0;
  for (const a of accounts) {
    try {
      const rows: SpendRow[] =
        a.platform === "meta"
          ? await fetchMetaSpend(a.external_id, from, to, env, fetchImpl)
          : await fetchGoogleSpend(a.external_id, from, to, env, fetchImpl);
      await db.transaction(async (tx) => {
        for (const r of rows)
          await tx.query(
            `insert into public.ad_spend (organization_id, ad_account_id, date, campaign_id, campaign_name, spend_grosze, impressions, clicks, platform_leads, updated_at)
             values ($1,$2,$3::date,$4,$5,$6,$7,$8,$9, now())
             on conflict (ad_account_id, date, campaign_id) do update set campaign_name = excluded.campaign_name,
               spend_grosze = excluded.spend_grosze, impressions = excluded.impressions, clicks = excluded.clicks,
               platform_leads = excluded.platform_leads, updated_at = now()`,
            [
              a.organization_id,
              a.id,
              r.date,
              r.campaignId,
              r.campaignName.slice(0, 200),
              r.spendGrosze,
              r.impressions,
              r.clicks,
              r.platformLeads,
            ],
          );
        await tx.query(
          "update public.ad_accounts set last_synced_at = now(), last_error = null where id = $1",
          [a.id],
        );
      });
      synced++;
    } catch (error) {
      failed++;
      await db.query(
        "update public.ad_accounts set last_synced_at = now(), last_error = $2 where id = $1",
        [a.id, (error as Error).message.slice(0, 500)],
      );
    }
  }
  return { synced, failed, skipped: false };
}
