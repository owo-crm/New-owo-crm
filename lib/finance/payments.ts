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

/**
 * План платежей по договору Barowo: 500 zł при подписании, 1000 zł за 7 дней
 * до мероприятия, остаток в день мероприятия (пункты 2, 3 и 6 договора).
 */
export function barowoSchedule(input: {
  priceGrosze: number;
  depositGrosze: number;
  depositDate: string;
  eventDate: string;
  today: string;
}) {
  const reservation = Math.min(50000, input.depositGrosze);
  const second = input.depositGrosze - reservation;
  const balance = input.priceGrosze - input.depositGrosze;
  const rows: { kind: string; label: string; amount_grosze: number; due_date: string }[] = [
    {
      kind: "deposit",
      label: "Zaliczka rezerwacyjna",
      amount_grosze: reservation,
      due_date: input.today,
    },
  ];
  if (second > 0)
    rows.push({
      kind: "deposit",
      label: "Druga zaliczka",
      amount_grosze: second,
      due_date: input.depositDate,
    });
  if (balance > 0)
    rows.push({
      kind: "balance",
      label: "Wynagrodzenie końcowe",
      amount_grosze: balance,
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
