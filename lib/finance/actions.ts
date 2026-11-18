"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { markPayment } from "./payments";

/** Отметка «деньги пришли» / отмена отметки прямо из карточки лида. */
export async function togglePaymentAction(id: string, paid: boolean) {
  if (!z.uuid().safeParse(id).success) return { error: "Nie udało się zapisać." };
  try {
    const leadId = await markPayment(id, paid);
    if (!leadId) return { error: "Nie znaleziono płatności." };
    revalidatePath(`/leady/${leadId}`);
    revalidatePath("/finanse");
    revalidatePath("/dzisiaj");
    return { ok: true };
  } catch {
    return { error: "Nie udało się zapisać." };
  }
}

/** План предоплат бизнеса (решение 049): от 0 до 5 сумм в złotych. Только владелец/админ. */
export async function savePaymentPlanAction(amounts: string[]) {
  const { withOrg } = await import("@/lib/db/user");
  const { parseMoney } = await import("./money");
  let plan: number[];
  try {
    plan = z
      .array(z.string())
      .max(5)
      .parse(amounts)
      .map((a) => parseMoney(a));
    if (plan.some((n) => n <= 0)) throw new Error("zero");
  } catch {
    return { error: "Wpisz kwoty większe od zera, np. 500." };
  }
  try {
    await withOrg(async (tx, { organization }) => {
      if (!["owner", "admin"].includes(organization.role)) throw new Error("forbidden");
      await tx.query("update public.organizations set payment_plan=$1 where id=$2", [
        JSON.stringify(plan),
        organization.id,
      ]);
    });
  } catch {
    return { error: "Tylko właściciel lub administrator może zmienić plan płatności." };
  }
  revalidatePath("/ustawienia/firma");
  revalidatePath("/leady", "layout");
  return { ok: true };
}
