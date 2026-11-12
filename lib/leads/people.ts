import "server-only";
import { z } from "zod";
import { withOrg } from "@/lib/db/user";

/**
 * Клиенты и умовы — разные взгляды на те же лиды (решение 036).
 * Клиентом человек становится, когда ему выслали умову; подписанная умова попадает
 * в отдельный список. Человека узнаём по телефону, а если его нет — по почте.
 */

const client = z.object({
  person_key: z.string(),
  lead_id: z.uuid(),
  client_name: z.string(),
  phone_e164: z.string().nullable(),
  email: z.string().nullable(),
  stage_key: z.string(),
  leads: z.coerce.number(),
  contracts: z.coerce.number(),
  last_event: z.string().nullable(),
  first_seen: z.string(),
  last_seen: z.string(),
});
export type ClientRow = z.infer<typeof client>;

const contract = z.object({
  lead_id: z.uuid(),
  client_name: z.string(),
  phone_e164: z.string().nullable(),
  email: z.string().nullable(),
  stage_key: z.string(),
  event_date: z.string().nullable(),
  event_type: z.string().nullable(),
  event_city: z.string().nullable(),
  number: z.string().nullable(),
  signed_at: z.string(),
  amount_grosze: z.coerce.number(),
  paid_grosze: z.coerce.number(),
});
export type ContractRow = z.infer<typeof contract>;

export function listClients(query?: string) {
  return withOrg(async (tx, { organization }) => {
    const { rows } = await tx.query("select * from public.clients_list($1,$2)", [
      organization.id,
      query ?? null,
    ]);
    return client.array().parse(rows);
  });
}

export function listContracts(query?: string) {
  return withOrg(async (tx, { organization }) => {
    const { rows } = await tx.query("select * from public.contracts_list($1,$2)", [
      organization.id,
      query ?? null,
    ]);
    return contract.array().parse(rows);
  });
}
