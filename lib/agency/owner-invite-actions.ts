"use server";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb, one, sqlState } from "@/lib/db";
import { withOrg } from "@/lib/db/user";
import { appConfig } from "@/lib/config";
import { t } from "@/lib/i18n";
import { requireAgency } from "./repository";
import { createClientOwnerInvite, revokeClientOwnerInvite } from "./owner-invite";

export type OwnerInviteResult = { ok?: true; url?: string; error?: string };

async function origin() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!host || !/^[a-z0-9.:-]+$/i.test(host)) return appConfig.siteUrl;
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

/** Klient agencji → jego organizacja CRM (tylko w obrębie własnej agencji). */
async function target(clientId: string) {
  const { organization, user } = await requireAgency();
  if (!user.isPlatformAdmin || !z.uuid().safeParse(clientId).success) return null;
  const row = await withOrg((tx) =>
    one<{ client_org_id: string | null }>(
      tx,
      "select client_org_id from public.agency_clients where organization_id=$1 and id=$2",
      [organization.id, clientId],
    ),
  );
  return row?.client_org_id ? { agency: organization.id, org: row.client_org_id, user } : null;
}

/** Jednorazowy link dla właściciela (7 dni). Poprzedni niewykorzystany link przestaje działać. */
export async function createOwnerInviteAction(clientId: string): Promise<OwnerInviteResult> {
  const tg = await target(clientId);
  if (!tg) return { error: t("agency.errors.adminOnly") };
  try {
    const token = await createClientOwnerInvite(getDb(), tg.user.id, tg.agency, tg.org);
    revalidatePath(`/agencja/klienci/${clientId}`);
    return { ok: true, url: `${await origin()}/zaproszenie/${token}` };
  } catch (error) {
    const msg = (error as Error).message;
    if (sqlState(error) === "22023" && msg.includes("owner exists"))
      return { error: t("agency.owner.exists") };
    if (sqlState(error) === "42501") return { error: t("agency.owner.notClient") };
    console.error("[agency] owner invite", msg); // bez tokenu
    return { error: t("common.unknownError") };
  }
}

export async function revokeOwnerInviteAction(clientId: string): Promise<OwnerInviteResult> {
  const tg = await target(clientId);
  if (!tg) return { error: t("agency.errors.adminOnly") };
  try {
    await revokeClientOwnerInvite(getDb(), tg.user.id, tg.agency, tg.org);
  } catch (error) {
    console.error("[agency] owner revoke", (error as Error).message);
    return { error: t("common.unknownError") };
  }
  revalidatePath(`/agencja/klienci/${clientId}`);
  return { ok: true };
}
