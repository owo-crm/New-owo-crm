import "server-only";
import { z } from "zod";
import { withOrg } from "@/lib/db/user";

/**
 * Лид агентства: поверх обычного лида хранится то, чего нет у других отраслей —
 * кто его привёл, какие услуги он потенциально возьмёт и ожидаемый рекламный бюджет.
 * Отдельной таблицей, чтобы не трогать общую public.leads.
 */

export const agencyLeadDetails = z.object({
  referredBy: z.uuid().nullable(),
  contactName: z.string().trim().max(200).nullable(),
  monthlyBudgetGrosze: z.number().int().min(0).max(10_000_000_000).nullable(),
  note: z.string().trim().max(2000).nullable(),
  serviceIds: z.array(z.uuid()).max(20),
});
export type AgencyLeadDetails = z.infer<typeof agencyLeadDetails>;

export async function saveLeadDetails(leadId: string, input: AgencyLeadDetails) {
  return withOrg(async (tx, { organization }) => {
    await tx.query(
      `insert into public.agency_lead_details
         (organization_id, lead_id, referred_by, contact_name, monthly_budget_grosze, note)
       values ($1,$2,$3,$4,$5,$6)
       on conflict (organization_id, lead_id) do update
         set referred_by = excluded.referred_by,
             contact_name = excluded.contact_name,
             monthly_budget_grosze = excluded.monthly_budget_grosze,
             note = excluded.note`,
      [
        organization.id,
        leadId,
        input.referredBy,
        input.contactName,
        input.monthlyBudgetGrosze,
        input.note,
      ],
    );
    await tx.query(
      "delete from public.agency_lead_services where organization_id=$1 and lead_id=$2",
      [organization.id, leadId],
    );
    for (const serviceId of input.serviceIds)
      await tx.query(
        `insert into public.agency_lead_services (organization_id, lead_id, service_id)
         values ($1,$2,$3) on conflict do nothing`,
        [organization.id, leadId, serviceId],
      );
  });
}

export async function getLeadDetails(leadId: string) {
  return withOrg(async (tx, { organization }) => {
    const { rows } = await tx.query<{
      referred_by: string | null;
      contact_name: string | null;
      monthly_budget_grosze: string | null;
      note: string | null;
    }>(
      `select referred_by, contact_name, monthly_budget_grosze, note from public.agency_lead_details
       where organization_id=$1 and lead_id=$2`,
      [organization.id, leadId],
    );
    const { rows: services } = await tx.query<{ service_id: string; name: string }>(
      `select ls.service_id, s.name from public.agency_lead_services ls
       join public.agency_services s on s.organization_id = ls.organization_id and s.id = ls.service_id
       where ls.organization_id=$1 and ls.lead_id=$2 order by s.name`,
      [organization.id, leadId],
    );
    const row = rows[0];
    return {
      referredBy: row?.referred_by ?? null,
      contactName: row?.contact_name ?? null,
      monthlyBudgetGrosze: row?.monthly_budget_grosze ? Number(row.monthly_budget_grosze) : null,
      note: row?.note ?? null,
      services,
    };
  });
}
