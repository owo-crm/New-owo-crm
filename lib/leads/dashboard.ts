import "server-only";
import { cache } from "react";
import { z } from "zod";
import { withOrg } from "@/lib/db/user";
import { one } from "@/lib/db";

const waitingLead = z.object({
  id: z.uuid(),
  number: z.number(),
  client_name: z.string(),
  phone_e164: z.string().nullable(),
  email: z.string().nullable(),
  source_label: z.string(),
  event_date: z.string().nullable(),
  event_type: z.string().nullable(),
  event_city: z.string().nullable(),
  guests: z.number().nullable(),
  stage_key: z.string(),
  created_at: z.string(),
});
const queueSchema = z.object({
  now: z.string(),
  waiting_count: z.number(),
  waiting: waitingLead.array(),
  mine_count: z.number(),
  tasks_count: z.number(),
  tasks: z
    .object({
      id: z.uuid(),
      client_name: z.string(),
      phone_e164: z.string().nullable(),
      due_at: z.string(),
      title: z.string().nullable(),
    })
    .array(),
  upcoming: z
    .object({
      id: z.uuid(),
      client_name: z.string(),
      event_date: z.string(),
      event_type: z.string().nullable(),
      event_city: z.string().nullable(),
      confirmed: z.boolean(),
    })
    .array(),
  response_minutes: z.number().nullable(),
  month_leads: z.number(),
  month_won: z.number(),
  form_connected: z.boolean(),
});
export type WorkQueue = z.infer<typeof queueSchema>;
export type WaitingLead = z.infer<typeof waitingLead>;

/** Очередь работы на главном экране: кто ждёт ответа, что на сегодня, ближайшие события. */
export const getWorkQueue = cache(async (): Promise<WorkQueue> => {
  const row = await withOrg((tx, { user, organization }) =>
    one<{ data: unknown }>(tx, "select public.work_queue($1,$2) as data", [
      organization.id,
      user.id,
    ]),
  );
  return queueSchema.parse(row?.data);
});

export type CalendarEvent = {
  event_date: string;
  id: string;
  client_name: string;
  event_type: string | null;
  event_city: string | null;
  confirmed: boolean;
  stage_key: string;
};

export function getCalendarEvents(from: string, to: string) {
  return withOrg(async (tx, { organization }) => {
    const { rows } = await tx.query<CalendarEvent>(
      "select * from public.calendar_events($1,$2,$3)",
      [organization.id, from, to],
    );
    return rows;
  });
}
