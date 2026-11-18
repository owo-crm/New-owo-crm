import "server-only";
import { withOrg } from "@/lib/db/user";
import { one, type Queryable } from "@/lib/db";

export type Payment = {
  id: string;
  lead_id: string;
  kind: "deposit" | "balance" | "other";
  label: string;
  amount_grosze: number;
  due_date: string | null;
  paid_at: string | null;
  position: number;
};

/** Деньги в грошах → «6 500,00 zł». */
export function formatMoney(grosze: number) {
  return new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN" }).format(
    grosze / 100,
  );
}

export function parseMoney(text: string) {
  const clean = text.replace(/\s/g, "").replace(",", ".").replace(/zł$/i, "");
  if (!/^\d{1,8}(\.\d{1,2})?$/.test(clean)) throw new Error("invalid_money");
  return Math.round(Number(clean) * 100);
}

export async function listPayments(tx: Queryable, orgId: string, leadId: string) {
  const { rows } = await tx.query<Payment>(
    `select id, lead_id, kind, label, amount_grosze, due_date::text as due_date, paid_at, position
     from public.lead_payments where organization_id=$1 and lead_id=$2 order by position, due_date`,
    [orgId, leadId],
  );
  return rows;
}

/** План предоплат бизнеса (решение 049): суммы в грошах по порядку. Barowo — 500 + 1000. */
export const DEFAULT_PAYMENT_PLAN = [50000, 100000];

export async function loadPaymentPlan(tx: Queryable, orgId: string): Promise<number[]> {
  const row = await one<{ plan: unknown }>(
    tx,
    "select payment_plan as plan from public.organizations where id=$1",
    [orgId],
  );
  const plan = Array.isArray(row?.plan) ? row.plan : DEFAULT_PAYMENT_PLAN;
  return plan.map(Number).filter((n) => Number.isInteger(n) && n > 0);
}

export function installmentLabel(index: number, count: number) {
  if (count === 1) return "Zaliczka";
  return index === 0 ? "Zaliczka rezerwacyjna" : `Zaliczka ${index + 1}`;
}

/**
 * План платежей по договору: первая предоплата — при подписании, остальные — к дате
 * предоплаты (7 дней до события), остаток — в день события.
 */
export function barowoSchedule(input: {
  priceGrosze: number;
  plan?: number[];
  depositDate: string;
  eventDate: string;
  today: string;
}) {
  const plan = input.plan ?? DEFAULT_PAYMENT_PLAN;
  const rows: { kind: string; label: string; amount_grosze: number; due_date: string }[] = [];
  let left = input.priceGrosze;
  plan.forEach((amount, i) => {
    const take = Math.min(amount, left);
    if (take <= 0) return;
    left -= take;
    rows.push({
      kind: "deposit",
      label: installmentLabel(i, plan.length),
      amount_grosze: take,
      due_date: i === 0 ? input.today : input.depositDate,
    });
  });
  if (left > 0)
    rows.push({
      kind: "balance",
      label: "Wynagrodzenie końcowe",
      amount_grosze: left,
      due_date: input.eventDate,
    });
  return rows;
}

export async function savePaymentPlan(
  tx: Queryable,
  orgId: string,
  leadId: string,
  rows: object[],
) {
  await tx.query("select public.set_contract_payments($1,$2,$3)", [
    orgId,
    leadId,
    JSON.stringify(rows),
  ]);
}

/** Отметить платёж оплаченным или снять отметку. */
export async function markPayment(id: string, paid: boolean) {
  return withOrg(async (tx, { organization }) => {
    const row = await one<{ lead_id: string }>(
      tx,
      "update public.lead_payments set paid_at=$1 where organization_id=$2 and id=$3 returning lead_id",
      [paid ? new Date().toISOString() : null, organization.id, id],
    );
    return row?.lead_id ?? null;
  });
}
