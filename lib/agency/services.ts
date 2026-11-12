import "server-only";
import { cache } from "react";
import { withOrg } from "@/lib/db/user";
import { requireAgency } from "./repository";

/**
 * Услуги агентства (решение 027): у услуги один ответственный — он получает 65 % по её заказам.
 * Клиенту назначаются услуги со своей ценой. Всё — через RLS (withOrg).
 */
export type Service = {
  id: string;
  name: string;
  description: string | null;
  owner_id: string;
  kind: "retainer" | "project";
  active: boolean;
  system_key: "crm" | "ads" | null;
};

export type ClientService = {
  id: string;
  service_id: string;
  name: string;
  owner_id: string;
  kind: "retainer" | "project";
  system_key: "crm" | "ads" | null;
  monthly_budget_grosze: number | null;
  active: boolean;
};

async function agency<T>(fn: Parameters<typeof withOrg<T>>[0]) {
  await requireAgency();
  return withOrg(fn);
}

export const listServices = cache(() =>
  agency(async (tx, { organization }) => {
    const { rows } = await tx.query<Service>(
      `select id, name, description, owner_id, kind, active, system_key
       from public.agency_services where organization_id=$1
       order by active desc, (system_key is null), system_key, name`,
      [organization.id],
    );
    return rows;
  }),
);

export async function saveService(input: {
  id?: string;
  name: string;
  description: string | null;
  ownerId: string;
  kind: "retainer" | "project";
  active: boolean;
  systemKey?: "crm" | "ads" | null;
}) {
  return agency(async (tx, { organization }) => {
    const v = [
      organization.id,
      input.name,
      input.description,
      input.ownerId,
      input.kind,
      input.active,
    ];
    if (input.id)
      await tx.query(
        `update public.agency_services set name=$2, description=$3, owner_id=$4, kind=$5, active=$6
         where organization_id=$1 and id=$7`,
        [...v, input.id],
      );
    else
      await tx.query(
        `insert into public.agency_services (organization_id, name, description, owner_id, kind, active, system_key)
         values ($1,$2,$3,$4,$5,$6,$7)`,
        [...v, input.systemKey ?? null],
      );
  });
}

export const listClientServices = cache((clientId: string) =>
  agency(async (tx, { organization }) => {
    const { rows } = await tx.query<ClientService>(
      `select cs.id, cs.service_id, s.name, s.owner_id, s.kind, s.system_key, cs.monthly_budget_grosze, cs.active
       from public.agency_client_services cs join public.agency_services s on s.id = cs.service_id
       where cs.organization_id=$1 and cs.client_id=$2 order by cs.active desc, s.name`,
      [organization.id, clientId],
    );
    return rows.map((r) => ({
      ...r,
      monthly_budget_grosze:
        r.monthly_budget_grosze === null ? null : Number(r.monthly_budget_grosze),
    }));
  }),
);

/** Назначить услугу клиенту. У услуги цены нет; бюджет имеет смысл только для рекламы. */
export async function setClientService(input: {
  clientId: string;
  serviceId: string;
  monthlyBudgetGrosze: number | null;
  active: boolean;
}) {
  return agency((tx, { organization }) =>
    tx.query(
      `insert into public.agency_client_services (organization_id, client_id, service_id, monthly_budget_grosze, active)
       values ($1,$2,$3,$4,$5)
       on conflict (client_id, service_id) do update set monthly_budget_grosze = excluded.monthly_budget_grosze, active = excluded.active`,
      [organization.id, input.clientId, input.serviceId, input.monthlyBudgetGrosze, input.active],
    ),
  );
}

export async function removeClientService(id: string) {
  return agency((tx, { organization }) =>
    tx.query("delete from public.agency_client_services where organization_id=$1 and id=$2", [
      organization.id,
      id,
    ]),
  );
}

export const listContributions = cache(() =>
  agency(async (tx, { organization }) => {
    const { rows } = await tx.query<{
      id: string;
      user_id: string;
      contributed_on: string;
      amount_grosze: number;
      note: string | null;
    }>(
      `select id, user_id, contributed_on::text as contributed_on, amount_grosze, note
       from public.agency_fund_contributions where organization_id=$1 order by contributed_on desc`,
      [organization.id],
    );
    return rows.map((r) => ({ ...r, amount_grosze: Number(r.amount_grosze) }));
  }),
);

export async function addContribution(input: {
  userId: string;
  date: string;
  amountGrosze: number;
  note: string | null;
}) {
  return agency((tx, { organization }) =>
    tx.query(
      `insert into public.agency_fund_contributions (organization_id, user_id, contributed_on, amount_grosze, note)
       values ($1,$2,$3::date,$4,$5)`,
      [organization.id, input.userId, input.date, input.amountGrosze, input.note],
    ),
  );
}
