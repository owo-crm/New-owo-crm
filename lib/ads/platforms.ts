/**
 * Получение расходов из Meta и Google Ads (решение 046). Только чтение статистики.
 * Ключи — переменные Railway; пока их нет, синхронизация просто не запускается.
 *
 * Meta:   META_ACCESS_TOKEN (System User агентского Business Manager с доступом ads_read
 *         к рекламным аккаунтам клиентов), META_API_VERSION (по умолчанию v21.0).
 * Google: GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET,
 *         GOOGLE_ADS_REFRESH_TOKEN, GOOGLE_ADS_LOGIN_CUSTOMER_ID (MCC агентства),
 *         GOOGLE_ADS_API_VERSION (по умолчанию v18).
 * Версии API вынесены в переменные: платформы регулярно выпускают новые.
 */
export type SpendRow = {
  date: string;
  campaignId: string;
  campaignName: string;
  spendGrosze: number;
  impressions: number;
  clicks: number;
  platformLeads: number;
};

type Env = Record<string, string | undefined>;
type Fetch = typeof fetch;

export function metaConfigured(env: Env) {
  return Boolean(env.META_ACCESS_TOKEN);
}
export function googleConfigured(env: Env) {
  return Boolean(
    env.GOOGLE_ADS_DEVELOPER_TOKEN &&
    env.GOOGLE_ADS_CLIENT_ID &&
    env.GOOGLE_ADS_CLIENT_SECRET &&
    env.GOOGLE_ADS_REFRESH_TOKEN,
  );
}

/** Деньги платформы (строка «12.34» или микро-единицы) → гроши. */
const toGrosze = (major: number) => Math.round(major * 100);

const LEAD_ACTIONS = new Set([
  "lead",
  "onsite_conversion.lead_grouped",
  "offsite_conversion.fb_pixel_lead",
]);

/** Meta Marketing API: insights по кампаниям по дням. */
export async function fetchMetaSpend(
  accountId: string,
  from: string,
  to: string,
  env: Env,
  fetchImpl: Fetch = fetch,
): Promise<SpendRow[]> {
  const version = env.META_API_VERSION || "v21.0";
  const act = accountId.startsWith("act_") ? accountId : `act_${accountId}`;
  const params = new URLSearchParams({
    level: "campaign",
    fields: "campaign_id,campaign_name,spend,impressions,clicks,actions",
    time_increment: "1",
    time_range: JSON.stringify({ since: from, until: to }),
    limit: "500",
    access_token: env.META_ACCESS_TOKEN ?? "",
  });
  let url: string | null = `https://graph.facebook.com/${version}/${act}/insights?${params}`;
  const rows: SpendRow[] = [];
  while (url) {
    const res: Response = await fetchImpl(url);
    const json = (await res.json()) as {
      data?: {
        date_start: string;
        campaign_id: string;
        campaign_name: string;
        spend?: string;
        impressions?: string;
        clicks?: string;
        actions?: { action_type: string; value: string }[];
      }[];
      paging?: { next?: string };
      error?: { message?: string };
    };
    if (!res.ok) throw new Error(`Meta: ${json.error?.message ?? res.status}`);
    for (const r of json.data ?? [])
      rows.push({
        date: r.date_start,
        campaignId: r.campaign_id,
        campaignName: r.campaign_name,
        spendGrosze: toGrosze(Number(r.spend ?? 0)),
        impressions: Number(r.impressions ?? 0),
        clicks: Number(r.clicks ?? 0),
        platformLeads: (r.actions ?? [])
          .filter((a) => LEAD_ACTIONS.has(a.action_type))
          .reduce((s, a) => Math.max(s, Number(a.value)), 0),
      });
    url = json.paging?.next ?? null;
  }
  return rows;
}

/** Google Ads API: GAQL по кампаниям по дням (через MCC агентства). */
export async function fetchGoogleSpend(
  customerId: string,
  from: string,
  to: string,
  env: Env,
  fetchImpl: Fetch = fetch,
): Promise<SpendRow[]> {
  const version = env.GOOGLE_ADS_API_VERSION || "v18";
  const tokenRes = await fetchImpl("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_ADS_CLIENT_ID ?? "",
      client_secret: env.GOOGLE_ADS_CLIENT_SECRET ?? "",
      refresh_token: env.GOOGLE_ADS_REFRESH_TOKEN ?? "",
      grant_type: "refresh_token",
    }),
  });
  const token = (await tokenRes.json()) as { access_token?: string; error_description?: string };
  if (!tokenRes.ok || !token.access_token)
    throw new Error(`Google OAuth: ${token.error_description ?? tokenRes.status}`);
  const cid = customerId.replace(/-/g, "");
  const query = `SELECT campaign.id, campaign.name, segments.date, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions FROM campaign WHERE segments.date BETWEEN '${from}' AND '${to}'`;
  const res = await fetchImpl(
    `https://googleads.googleapis.com/${version}/customers/${cid}/googleAds:searchStream`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token.access_token}`,
        "developer-token": env.GOOGLE_ADS_DEVELOPER_TOKEN ?? "",
        "content-type": "application/json",
        ...(env.GOOGLE_ADS_LOGIN_CUSTOMER_ID
          ? { "login-customer-id": env.GOOGLE_ADS_LOGIN_CUSTOMER_ID.replace(/-/g, "") }
          : {}),
      },
      body: JSON.stringify({ query }),
    },
  );
  const json = (await res.json()) as
    | {
        results?: {
          campaign: { id: string; name: string };
          segments: { date: string };
          metrics: {
            costMicros?: string;
            impressions?: string;
            clicks?: string;
            conversions?: number;
          };
        }[];
      }[]
    | { error?: { message?: string } };
  if (!res.ok || !Array.isArray(json))
    throw new Error(`Google Ads: ${(!Array.isArray(json) && json.error?.message) || res.status}`);
  return json.flatMap((batch) =>
    (batch.results ?? []).map((r) => ({
      date: r.segments.date,
      campaignId: String(r.campaign.id),
      campaignName: r.campaign.name,
      spendGrosze: Math.round(Number(r.metrics.costMicros ?? 0) / 10_000),
      impressions: Number(r.metrics.impressions ?? 0),
      clicks: Number(r.metrics.clicks ?? 0),
      platformLeads: Math.round(Number(r.metrics.conversions ?? 0)),
    })),
  );
}
