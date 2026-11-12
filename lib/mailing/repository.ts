import "server-only";
import { z } from "zod";
import { withOrg } from "@/lib/db/user";

/** Чтение и запись рассылок. Всё — через RLS, как остальные данные фирмы. */

const contact = z.object({
  lead_id: z.uuid(),
  name: z.string(),
  email: z.string(),
  event_label: z.string().nullable(),
  event_date: z.string().nullable(),
  signed: z.boolean(),
  past: z.boolean(),
  created_days: z.number(),
  unsubscribed: z.boolean(),
  consent: z.boolean(),
});
export type Contact = z.infer<typeof contact>;

const template = z.object({
  id: z.uuid(),
  name: z.string(),
  subject: z.string(),
  body: z.string(),
  heading1: z.string().nullable(),
  heading2: z.string().nullable(),
  button_text: z.string().nullable(),
  button_url: z.string().nullable(),
});
export type Template = z.infer<typeof template>;

const campaign = z.object({
  id: z.uuid(),
  subject: z.string(),
  status: z.enum(["sending", "done", "cancelled"]),
  created_at: z.string(),
  sent: z.coerce.number(),
  pending: z.coerce.number(),
  failed: z.coerce.number(),
  total: z.coerce.number(),
});
export type Campaign = z.infer<typeof campaign>;

export function listContacts() {
  return withOrg(async (tx, { organization }) => {
    const { rows } = await tx.query("select * from public.mailing_contacts($1)", [organization.id]);
    return contact.array().parse(rows);
  });
}

export function listTemplates() {
  return withOrg(async (tx, { organization }) => {
    const { rows } = await tx.query(
      `select id, name, subject, body, heading1, heading2, button_text, button_url
       from public.mailing_templates where organization_id=$1 order by position, name`,
      [organization.id],
    );
    return template.array().parse(rows);
  });
}

export function listCampaigns() {
  return withOrg(async (tx, { organization }) => {
    const { rows } = await tx.query<{ data: unknown }>(
      "select public.mailing_summary($1) as data",
      [organization.id],
    );
    return campaign.array().parse(rows[0]?.data ?? []);
  });
}

export function saveTemplate(input: {
  id?: string;
  name: string;
  subject: string;
  body: string;
  heading1: string | null;
  heading2: string | null;
  buttonText: string | null;
  buttonUrl: string | null;
}) {
  return withOrg(async (tx, { organization }) => {
    const values = [
      organization.id,
      input.name,
      input.subject,
      input.body,
      input.heading1,
      input.heading2,
      input.buttonText,
      input.buttonUrl,
    ];
    if (input.id)
      await tx.query(
        `update public.mailing_templates set name=$2, subject=$3, body=$4, heading1=$5,
           heading2=$6, button_text=$7, button_url=$8
         where organization_id=$1 and id=$9`,
        [...values, input.id],
      );
    else
      await tx.query(
        `insert into public.mailing_templates
           (organization_id, name, subject, body, heading1, heading2, button_text, button_url)
         values ($1,$2,$3,$4,$5,$6,$7,$8)`,
        values,
      );
  });
}

export function startCampaign(
  letter: {
    subject: string;
    body: string;
    heading1: string | null;
    heading2: string | null;
    buttonText: string | null;
    buttonUrl: string | null;
  },
  leadIds: string[],
) {
  return withOrg(async (tx, { organization }) => {
    const { rows } = await tx.query<{ id: string }>(
      "select public.mailing_start($1,$2::jsonb,$3::uuid[]) as id",
      [organization.id, JSON.stringify(letter), leadIds],
    );
    const id = rows[0].id;
    const total = await tx.query<{ n: string }>(
      "select count(*) as n from public.mailing_recipients where campaign_id=$1",
      [id],
    );
    return { id, total: Number(total.rows[0].n) };
  });
}

export function optOut(organizationId: string, email: string) {
  return { organizationId, email };
}
