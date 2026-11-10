import "server-only";
import { cache } from "react";
import { z } from "zod";
import { withOrg } from "@/lib/db/user";
import { one } from "@/lib/db";

const money = z.coerce.number();
const item = z.object({
  id: z.uuid(),
  lead_id: z.uuid(),
  client_name: z.string(),
  label: z.string(),
  amount_grosze: money,
  due_date: z.string(),
});
const schema = z.object({
  month: z.string(),
  paid_grosze: money,
  expected_grosze: money,
  overdue_grosze: money,
  signed_grosze: money,
  overdue: item.array(),
  upcoming: item.array(),
  by_source: z
    .object({ source: z.string(), paid_grosze: money, open_grosze: money, leads: money })
    .array(),
  months: z.object({ month: z.string(), paid_grosze: money }).array(),
  funnel: z
    .object({ key: z.string(), label: z.string(), kind: z.string(), position: money, leads: money })
    .array(),
});
export type FinanceSummary = z.infer<typeof schema>;

export const getFinanceSummary = cache(async (month?: string) => {
  const row = await withOrg((tx, { organization }) =>
    one<{ data: unknown }>(tx, "select public.finance_summary($1,$2) as data", [
      organization.id,
      month ?? null,
    ]),
  );
  return schema.parse(row?.data);
});
