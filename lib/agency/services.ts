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
  default_price_grosze: number | null;
  active: boolean;
  system_key: "crm" | null;
};

export type ClientService = {
  id: string;
  service_id: string;
  name: string;
  owner_id: string;
  kind: "retainer" | "project";
  price_grosze: number;
  active: boolean;
};

async function agency<T>(fn: Parameters<typeof withOrg<T>>[0]) {
  await requireAgency();
  return withOrg(fn);
}

export const listServices = cache(() =>
  agency(async (tx, { organization }) => {
    const { rows } = await tx.query<Service>(
      `select id, name, description, owner_id, kind, default_price_grosze, active, system_key
       from public.agency_services where organization_id=$1 order by active desc, name`,
      [organization.id],
    );
    return rows.map((r) => ({
      ...r,
      default_price_grosze: r.default_price_grosze === null ? null : Number(r.default_price_grosze),
    }));
  }),
);

export async function saveService(input: {
  id?: string;
  name: string;
  description: string | null;
  ownerId: string;
  kind: "retainer" | "project";
  defaultPriceGrosze: number | null;
  active: boolean;
  systemKey?: "crm" | null;
}) {
  return agency(async (tx, { organization }) => {
    const v = [
      organization.id,
      input.name,
      input.description,
      input.ownerId,
      input.kind,
      input.defaultPriceGrosze,
      input.active,
    ];
    if (input.id)
      await tx.query(
        `update public.agency_services set name=$2, description=$3, owner_id=$4, kind=$5, default_price_grosze=$6, active=$7
         where organization_id=$1 and id=$8`,
        [...v, input.id],
      );
    else
      await tx.query(
        `insert into public.agency_services (organization_id, name, description, owner_id, kind, default_price_grosze, active, system_key)
         values ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [...v, input.systemKey ?? null],
      );
  });
}

export const listClientServices = cache((clientId: string) =>
  agency(async (tx, { organization }) => {
    const { rows } = await tx.query<ClientService>(
      `select cs.id, cs.service_id, s.name, s.owner_id, s.kind, cs.price_grosze, cs.active
       from public.agency_client_services cs join public.agency_services s on s.id = cs.service_id
       where cs.organization_id=$1 and cs.client_id=$2 order by cs.active desc, s.name`,
      [organization.id, clientId],
    );
    return rows.map((r) => ({ ...r, price_grosze: Number(r.price_grosze) }));
  }),
);

/** Назначить услугу клиенту или изменить её цену (повторное назначение = новая цена). */
export async function setClientService(input: {
  clientId: string;
  serviceId: string;
  priceGrosze: number;
  active: boolean;
}) {
  return agency((tx, { organization }) =>
    tx.query(
      `insert into public.agency_client_services (organization_id, client_id, service_id, price_grosze, active)
       values ($1,$2,$3,$4,$5)
       on conflict (client_id, service_id) do update set price_grosze = excluded.price_grosze, active = excluded.active`,
      [organization.id, input.clientId, input.serviceId, input.priceGrosze, input.active],
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
