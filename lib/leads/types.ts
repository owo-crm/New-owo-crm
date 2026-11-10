import { z } from "zod";
export const leadSchema = z.object({
  id: z.uuid(),
  number: z.number().int(),
  organization_id: z.uuid(),
  stage_key: z.string(),
  legacy_uid: z.string().nullable().default(null),
  client_name: z.string(),
  phone_e164: z.string().nullable(),
  email: z.string().nullable(),
  source_label: z.string(),
  source_channel_id: z.uuid().nullable(),
  event_type: z.string().nullable(),
  event_date: z.string().nullable(),
  event_city: z.string().nullable(),
  venue: z.string().nullable(),
  guests: z.number().nullable(),
  budget_grosze: z.number().nullable(),
  message: z.string(),
  assigned_to: z.uuid().nullable(),
  first_response_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  deleted_at: z.string().nullable(),
});
export type Lead = z.infer<typeof leadSchema>;
export type PipelineStage = {
  key: string;
  label_pl: string;
  position: number;
  kind: "open" | "won" | "lost";
};
export type LeadChannel = { id: string; name: string };
export type TeamMember = {
  user_id: string;
  display_name: string | null;
  profiles: { full_name: string | null } | null;
};
