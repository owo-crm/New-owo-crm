import "server-only";
import { cache } from "react";
import { withOrg } from "@/lib/db/user";

/**
 * Подключённые рекламные кабинеты клиента. Расход заполняет импорт статистики,
 * которого пока нет: пока spend_synced_at пуст, экран честно пишет, что данных нет,
 * и не показывает нулей, которые можно принять за «потрачено 0».
 */

export type AdAccount = {
  id: string;
  platform: "google" | "meta";
  external_id: string;
  label: string | null;
  spend_mtd_grosze: number | null;
  spend_month: string | null;
  spend_synced_at: string | null;
};

export const listAdAccounts = cache((clientId: string) =>
  withOrg(async (tx, { organization }) => {
    const { rows } = await tx.query<AdAccount & { spend_mtd_grosze: string | null }>(
      `select id, platform, external_id, label, spend_mtd_grosze, spend_month::text, spend_synced_at
       from public.agency_ad_accounts where organization_id=$1 and client_id=$2 order by platform`,
      [organization.id, clientId],
    );
    return rows.map((r) => ({
      ...r,
      spend_mtd_grosze: r.spend_mtd_grosze === null ? null : Number(r.spend_mtd_grosze),
    }));
  }),
);

export async function saveAdAccount(input: {
  clientId: string;
  platform: "google" | "meta";
  externalId: string;
  label: string | null;
}) {
  return withOrg((tx, { organization }) =>
    tx.query(
      `insert into public.agency_ad_accounts (organization_id, client_id, platform, external_id, label)
       values ($1,$2,$3,$4,$5)
       on conflict (client_id, platform) do update
         set external_id = excluded.external_id, label = excluded.label`,
      [organization.id, input.clientId, input.platform, input.externalId, input.label],
    ),
  );
}

export async function removeAdAccount(clientId: string, id: string) {
  return withOrg((tx, { organization }) =>
    tx.query(
      "delete from public.agency_ad_accounts where organization_id=$1 and client_id=$2 and id=$3",
      [organization.id, clientId, id],
    ),
  );
}
