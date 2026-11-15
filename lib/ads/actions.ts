"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withOrg } from "@/lib/db/user";
import { t } from "@/lib/i18n";

/** Действия вкладки «Reklama» (решение 046). Пишут только owner/admin (и RLS в базе). */
export type AdsResult = { ok?: true; error?: string };

const admin = (role: string) => ["owner", "admin"].includes(role);

export async function addAdAccountAction(raw: unknown): Promise<AdsResult> {
  const parsed = z
    .object({
      platform: z.enum(["meta", "google"]),
      externalId: z
        .string()
        .trim()
        .min(3)
        .max(40)
        .regex(/^(act_)?[0-9-]+$/),
      name: z.string().trim().min(1).max(120),
    })
    .safeParse(raw);
  if (!parsed.success) return { error: t("ads.errors.account") };
  try {
    await withOrg(async (tx, { organization }) => {
      if (!admin(organization.role)) throw new Error("forbidden");
      await tx.query(
        "insert into public.ad_accounts (organization_id, platform, external_id, name) values ($1,$2,$3,$4)",
        [organization.id, parsed.data.platform, parsed.data.externalId, parsed.data.name],
      );
    });
  } catch (error) {
    return {
      error:
        (error as Error).message === "forbidden"
          ? t("ads.errors.admin")
          : t("ads.errors.duplicate"),
    };
  }
  revalidatePath("/reklama");
  return { ok: true };
}

export async function toggleAdAccountAction(id: string, active: boolean): Promise<AdsResult> {
  if (!z.uuid().safeParse(id).success) return { error: t("ads.errors.account") };
  await withOrg((tx, { organization }) =>
    tx.query("update public.ad_accounts set status=$3 where organization_id=$1 and id=$2", [
      organization.id,
      id,
      active ? "active" : "paused",
    ]),
  ).catch(() => null);
  revalidatePath("/reklama");
  return { ok: true };
}

export async function deleteAdAccountAction(id: string): Promise<AdsResult> {
  if (!z.uuid().safeParse(id).success) return { error: t("ads.errors.account") };
  await withOrg((tx, { organization }) =>
    tx.query("delete from public.ad_accounts where organization_id=$1 and id=$2", [
      organization.id,
      id,
    ]),
  ).catch(() => null);
  revalidatePath("/reklama");
  return { ok: true };
}

/**
 * Ручной ввод расхода: кампания за месяц (пока API не подключены или для других платформ).
 * Название кампании = значение utm_campaign в ссылках рекламы — так заявки сопоставятся сами.
 */
export async function addManualSpendAction(raw: unknown): Promise<AdsResult> {
  const parsed = z
    .object({
      campaign: z.string().trim().min(1).max(200),
      month: z.string().regex(/^\d{4}-\d{2}$/),
      spendGrosze: z.number().int().min(1).max(10_000_000_000),
      clicks: z.number().int().min(0).max(100_000_000).default(0),
    })
    .safeParse(raw);
  if (!parsed.success) return { error: t("ads.errors.spend") };
  try {
    await withOrg(async (tx, { organization }) => {
      if (!admin(organization.role)) throw new Error("forbidden");
      // Один «ручной» аккаунт на бизнес — создаём при первом вводе.
      const { rows } = await tx.query<{ id: string }>(
        `with found as (select id from public.ad_accounts where organization_id=$1 and platform='manual' limit 1),
              made as (insert into public.ad_accounts (organization_id, platform, name)
                       select $1, 'manual', $2 where not exists (select 1 from found) returning id)
         select id from found union all select id from made`,
        [organization.id, t("ads.manualAccount")],
      );
      await tx.query(
        `insert into public.ad_spend (organization_id, ad_account_id, date, campaign_id, campaign_name, spend_grosze, clicks)
         values ($1,$2,$3::date,$4,$4,$5,$6)
         on conflict (ad_account_id, date, campaign_id) do update set spend_grosze = excluded.spend_grosze,
           clicks = excluded.clicks, updated_at = now()`,
        [
          organization.id,
          rows[0].id,
          `${parsed.data.month}-01`,
          parsed.data.campaign,
          parsed.data.spendGrosze,
          parsed.data.clicks,
        ],
      );
    });
  } catch (error) {
    return {
      error:
        (error as Error).message === "forbidden" ? t("ads.errors.admin") : t("ads.errors.spend"),
    };
  }
  revalidatePath("/reklama");
  return { ok: true };
}
