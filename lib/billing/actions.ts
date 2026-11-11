"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireOrganization } from "@/lib/auth/session";
import { appConfig } from "@/lib/config";
import { asUser, getDb, one, sqlState } from "@/lib/db";
import { withOrg } from "@/lib/db/user";
import { requireAgency } from "@/lib/agency/repository";
import { slugify } from "@/lib/organizations/slug";
import { isPresetKey } from "@/lib/presets";
import { t } from "@/lib/i18n";
import { ADDON_KEYS, isAddonKey } from "./modules";
import { resyncBilling } from "./service";
import { stripeConfig } from "./stripe";
import { createCheckoutLink, createPortalLink } from "./sync";

export type BillingResult = { ok?: true; error?: string; url?: string; message?: string };

// ───────── Сторона клиента ─────────

/** «Poproś o moduł»: заявка в кабинет агентства. Повторная заявка — тоже «ok». */
export async function requestModuleAction(module: string): Promise<BillingResult> {
  if (!isAddonKey(module)) return { error: t("agency.errors.invalid") };
  try {
    await withOrg((tx, { organization, user }) =>
      tx.query(
        "insert into public.module_requests (organization_id, module, requested_by) values ($1,$2,$3)",
        [organization.id, module, user.id],
      ),
    );
  } catch (error) {
    if (sqlState(error) !== "23505") {
      console.error("[billing] request", (error as Error).message);
      return { error: t("common.unknownError") };
    }
  }
  revalidatePath("/agencja");
  return { ok: true };
}

/** Портал Stripe: карта, счета, отмена. Только owner/admin бизнеса. */
export async function openPortalAction(): Promise<BillingResult> {
  const { organization } = await requireOrganization();
  const config = stripeConfig();
  if (!config || organization.role === "member")
    return { error: t("billing.settings.notConnected") };
  const customer = await getDb()
    .query<{ c: string | null }>(
      "select stripe_customer_id as c from public.organization_billing where organization_id=$1",
      [organization.id],
    )
    .then((r) => r.rows[0]?.c);
  if (!customer) return { error: t("billing.settings.notConnected") };
  let url: string;
  try {
    url = await createPortalLink(config, customer, `${appConfig.siteUrl}/ustawienia/abonament`);
  } catch (error) {
    console.error("[billing] portal", (error as Error).message);
    return { error: t("common.unknownError") };
  }
  redirect(url);
}

// ───────── Сторона агентства ─────────

/** Организация клиента агентства (только своего агентства). */
async function clientOrg(clientId: string) {
  const { organization, user } = await requireAgency();
  if (!z.uuid().safeParse(clientId).success) return null;
  const row = await withOrg((tx) =>
    one<{ client_org_id: string | null }>(
      tx,
      "select client_org_id from public.agency_clients where organization_id=$1 and id=$2",
      [organization.id, clientId],
    ),
  );
  return row?.client_org_id ? { org: row.client_org_id, user } : null;
}

const subscriptionSchema = z.object({
  modules: z.array(z.enum(ADDON_KEYS)).max(ADDON_KEYS.length),
  adClient: z.boolean(),
  discountPct: z.number().min(0).max(100),
  email: z.union([z.literal(""), z.email().max(254)]),
});

/**
 * Сохранить модули и условия абонемента клиента → пересчёт → Stripe (если подключён):
 * сумма подписки меняется сразу, доплата за остаток месяца списывается автоматически.
 */
export async function saveSubscriptionAction(
  clientId: string,
  raw: unknown,
): Promise<BillingResult> {
  const target = await clientOrg(clientId);
  if (!target) return { error: t("billing.agency.noCrm") };
  const parsed = subscriptionSchema.safeParse(raw);
  if (!parsed.success) return { error: t("agency.errors.invalid") };
  const { modules, adClient, discountPct, email } = parsed.data;
  try {
    // Модули — функцией в базе с проверкой прав агентства.
    await asUser(getDb(), target.user.id, (tx) =>
      tx.query("select public.set_organization_modules($1, $2)", [target.org, modules]),
    );
    await getDb().query(
      `insert into public.organization_billing (organization_id, ad_client, discount_bp, billing_email)
       values ($1, $2, $3, $4)
       on conflict (organization_id) do update set ad_client = excluded.ad_client,
         discount_bp = excluded.discount_bp, billing_email = excluded.billing_email`,
      [target.org, adClient, Math.round(discountPct * 100), email || null],
    );
  } catch (error) {
    console.error("[billing] save", (error as Error).message);
    return { error: t("common.unknownError") };
  }
  const result = await resyncBilling(target.org);
  revalidatePath(`/agencja/klienci/${clientId}`);
  if (!result) return { error: t("common.unknownError") };
  return {
    ok: true,
    message: t(result.mode === "stripe" ? "billing.agency.saved" : "billing.agency.savedLocal"),
  };
}

/** Ссылка на первую оплату (Stripe Checkout). Клиенту её отправляет человек — мы ничего не шлём сами. */
export async function checkoutLinkAction(clientId: string): Promise<BillingResult> {
  const target = await clientOrg(clientId);
  if (!target) return { error: t("billing.agency.noCrm") };
  const config = stripeConfig();
  if (!config) return { error: t("billing.agency.stripeOff") };
  try {
    const url = await createCheckoutLink(getDb(), target.org, config, appConfig.siteUrl);
    revalidatePath(`/agencja/klienci/${clientId}`);
    return { ok: true, url };
  } catch (error) {
    console.error("[billing] checkout", (error as Error).message);
    return { error: t("common.unknownError") };
  }
}

/**
 * Мастер «Utwórz CRM klienta»: бизнес клиента с отраслью и выбранными модулями,
 * участие OWO Ads — обслуживающее, клиент агентства привязан. Только админ платформы.
 */
export async function createClientCrmAction(
  clientId: string,
  raw: unknown,
): Promise<BillingResult> {
  const { organization, user } = await requireAgency();
  if (!user.isPlatformAdmin) return { error: t("agency.errors.adminOnly") };
  const parsed = z
    .object({ preset: z.string(), modules: z.array(z.enum(ADDON_KEYS)) })
    .safeParse(raw);
  if (!parsed.success || !z.uuid().safeParse(clientId).success || !isPresetKey(parsed.data.preset))
    return { error: t("agency.errors.invalid") };
  let org: string;
  try {
    org = await asUser(getDb(), user.id, async (tx) => {
      const client = await one<{ name: string; client_org_id: string | null }>(
        tx,
        "select name, client_org_id from public.agency_clients where organization_id=$1 and id=$2",
        [organization.id, clientId],
      );
      if (!client || client.client_org_id) throw new Error("client missing or already linked");
      const name = (client.name.length >= 2 ? client.name : `${client.name} CRM`).slice(0, 120);
      const created = await one<{ id: string }>(
        tx,
        "select public.create_organization($1,$2,$3) as id",
        [name, slugify(name) || "klient", parsed.data.preset],
      );
      await tx.query("select public.mark_service_membership($1)", [created!.id]);
      await tx.query(
        "update public.agency_clients set client_org_id=$3 where organization_id=$1 and id=$2",
        [organization.id, clientId, created!.id],
      );
      // Клиент уже связан — права агентства на модули проверятся внутри функции.
      await tx.query("select public.set_organization_modules($1, $2)", [
        created!.id,
        parsed.data.modules,
      ]);
      return created!.id;
    });
  } catch (error) {
    console.error("[billing] create crm", (error as Error).message);
    return { error: t("common.unknownError") };
  }
  await resyncBilling(org);
  revalidatePath(`/agencja/klienci/${clientId}`);
  return { ok: true };
}
