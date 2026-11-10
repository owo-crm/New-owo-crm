import "server-only";
import { cache } from "react";
import { z } from "zod";
import { withOrg } from "@/lib/db/user";
import { one } from "@/lib/db";
import { seasonYear } from "@/lib/season";
import { leadSchema } from "./types";
const dashboardSchema = z.object({
  waiting_count: z.number(),
  response_minutes: z.number().nullable(),
  month_leads: z.number(),
  month_won: z.number(),
  followups: z.number(),
  waiting: leadSchema.array(),
  inquiries: z.record(z.string(), z.literal("inquiry")),
  form_connected: z.boolean(),
});
export const getTodayData = cache(async () => {
  const now = new Date();
  const year = seasonYear(now);
  const row = await withOrg((tx, { organization }) =>
    one<{ data: unknown }>(tx, "select public.lead_dashboard($1, $2) as data", [
      organization.id,
      year,
    ]),
  );
  return { ...dashboardSchema.parse(row?.data), year, now: now.toISOString() };
});
