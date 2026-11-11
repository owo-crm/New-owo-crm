"use server";
import { z } from "zod";
import { withOrg } from "@/lib/db/user";

/** Быстрый поиск лидов для ⌘K: имя, телефон, e-mail — в текущем бизнесе (RLS). */
export async function quickSearchAction(query: string) {
  const q = z.string().trim().max(100).catch("").parse(query);
  if (q.length < 2) return [];
  return withOrg(async (tx, { organization }) => {
    const { rows } = await tx.query<{
      id: string;
      client_name: string;
      event_date: string | null;
      stage: string;
    }>(
      `select l.id, l.client_name, l.event_date::text as event_date, s.label_pl as stage
       from public.search_leads($1, $2) l
       join public.pipeline_stages s on s.organization_id = l.organization_id and s.key = l.stage_key
       order by l.created_at desc limit 8`,
      [organization.id, q],
    );
    return rows;
  }).catch(() => []);
}
