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
