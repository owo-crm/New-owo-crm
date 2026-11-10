import "server-only";
import { cache } from "react";
import { withOrg } from "@/lib/db/user";
import { one } from "@/lib/db";
import { leadSchema, type Lead, type LeadChannel, type PipelineStage } from "./types";
import type { LeadFilters } from "./filters";
const COLUMNS =
  "id,number,organization_id,stage_key,legacy_uid,client_name,phone_e164,email,source_label,source_channel_id,event_type,event_date,event_city,venue,guests,budget_grosze,message,assigned_to,first_response_at,created_at,updated_at,deleted_at";
export const getLeadOptions = cache(() =>
  withOrg(async (tx, { organization }) => {
    const [stages, channels, team] = await Promise.all([
      tx.query<PipelineStage>(
        "select key,label_pl,position,kind from public.pipeline_stages where organization_id=$1 order by position",
        [organization.id],
      ),
      tx.query<LeadChannel>(
        "select id,name from public.channels where organization_id=$1 order by name",
        [organization.id],
      ),
      tx.query<{ id: string; name: string }>(
        `select m.user_id as id, coalesce(nullif(m.display_name,''), nullif(p.full_name,''), left(m.user_id::text, 8)) as name
         from public.memberships m left join public.profiles p on p.user_id=m.user_id
         where m.organization_id=$1 order by m.created_at`,
        [organization.id],
      ),
    ]);
    return { stages: stages.rows, channels: channels.rows, team: team.rows };
  }),
);
export function getLeads(filters: LeadFilters) {
  return withOrg(async (tx, { organization }) => {
    const args = [
      organization.id,
      filters.q,
      filters.stage ?? null,
      filters.source ?? null,
      filters.assigned ?? null,
      filters.from ?? null,
      filters.to ?? null,
    ];
    const { rows } = await tx.query<Lead & { total: number }>(
      `select ${COLUMNS}, count(*) over() as total
       from public.search_leads($1,$2,$3,$4,$5,$6,$7) limit 50 offset $8`,
      [...args, (filters.page - 1) * 50],
    );
    let total = rows[0]?.total ?? 0;
    if (!rows.length && filters.page > 1) {
      total = (await one<{ n: number }>(
        tx,
        "select count(*) as n from public.search_leads($1,$2,$3,$4,$5,$6,$7)",
        args,
      ))!.n;
    }
    return { leads: leadSchema.array().parse(rows), total };
  });
}
export function getLead(id: string) {
  return withOrg((tx, { organization }) =>
    one<Lead>(
      tx,
      `select ${COLUMNS} from public.leads where organization_id=$1 and id=$2 and deleted_at is null`,
      [organization.id, id],
    ),
  );
}

export type LeadEvent = {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  actor_user_id: string | null;
  created_at: string;
};
export function getLeadHistory(id: string) {
  return withOrg(async (tx, { organization }) => {
    const { rows } = await tx.query<LeadEvent>(
      `select id,type,payload,actor_user_id,created_at from public.lead_events
       where organization_id=$1 and lead_id=$2 order by created_at desc limit 200`,
      [organization.id, id],
    );
    return rows;
  });
}
