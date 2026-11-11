"use server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { ORG_COOKIE, getOrganizations, requireUser } from "@/lib/auth/session";
import { sqlState } from "@/lib/db";
import { t } from "@/lib/i18n";
import {
  FUND_CATEGORIES,
  addFundExpense,
  addPayout,
  deleteFundExpense,
  clientFromLead,
  linkClientOrg,
  repeatRetainers,
  saveClient,
  saveOrder,
  setOrderStatus,
  setSetupMark,
} from "./repository";
import { ORDER_STATUSES, clientInputSchema, orderInputSchema } from "./schemas";

/** Серверные действия кабинета агентства. Ошибки — по-польски, без технических деталей. */

export type ActionResult = { ok?: true; id?: string; error?: string; count?: number };

function refresh(clientId?: string | null) {
  revalidatePath("/agencja");
  if (clientId) revalidatePath(`/agencja/klienci/${clientId}`);
}

function fail(error: unknown, scope: string): ActionResult {
  console.error(`[agency] ${scope}`, (error as Error).message);
  // 23514 — проверка в базе (например, исполнитель не из команды).
  return {
    error: sqlState(error) === "23514" ? t("agency.errors.invalid") : t("common.unknownError"),
  };
}

export async function saveOrderAction(raw: unknown): Promise<ActionResult> {
  const parsed = orderInputSchema.safeParse(raw);
  if (!parsed.success) return { error: t("agency.errors.invalid") };
  try {
    const id = await saveOrder(parsed.data);
    if (!id) return { error: t("agency.errors.notFound") };
    refresh(parsed.data.clientId);
    return { ok: true, id };
  } catch (error) {
    return fail(error, "save order");
  }
}

export async function setOrderStatusAction(id: string, status: string): Promise<ActionResult> {
  const parsed = z
    .object({ id: z.uuid(), status: z.enum(ORDER_STATUSES) })
    .safeParse({ id, status });
  if (!parsed.success) return { error: t("agency.errors.invalid") };
  try {
    const clientId = await setOrderStatus(parsed.data.id, parsed.data.status);
    if (!clientId) return { error: t("agency.errors.notFound") };
    refresh(clientId);
    return { ok: true };
  } catch (error) {
    return fail(error, "order status");
  }
}

export async function repeatRetainersAction(month: string): Promise<ActionResult> {
  if (!/^\d{4}-\d{2}$/.test(month)) return { error: t("agency.errors.invalid") };
  try {
    const count = await repeatRetainers(month);
    refresh();
    return { ok: true, count };
  } catch (error) {
    return fail(error, "repeat");
  }
}

export type ClientFormState = { error?: string; fields?: Record<string, string> };

export async function saveClientAction(
  _prev: ClientFormState,
  form: FormData,
): Promise<ClientFormState> {
  const parsed = clientInputSchema.safeParse({
    id: form.get("id") || undefined,
    name: form.get("name") ?? "",
    nip: form.get("nip") ?? "",
    contactName: form.get("contactName") ?? "",
    phone: form.get("phone") ?? "",
    email: form.get("email") ?? "",
    city: form.get("city") ?? "",
    status: form.get("status") ?? "lead",
    startedAt: form.get("startedAt") ?? "",
    note: form.get("note") ?? "",
  });
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues)
      fields[String(issue.path[0])] = t("agency.errors.field");
    return { error: t("agency.errors.invalid"), fields };
  }
  let id: string | null;
  try {
    id = await saveClient(parsed.data);
  } catch (error) {
    return fail(error, "save client");
  }
  if (!id) return { error: t("agency.errors.notFound") };
  refresh(id);
  redirect(`/agencja/klienci/${id}`);
}

export async function toggleSetupMarkAction(
  clientId: string,
  step: string,
  done: boolean,
): Promise<ActionResult> {
  if (!z.uuid().safeParse(clientId).success || !/^[a-z_]{1,50}$/.test(step))
    return { error: t("agency.errors.invalid") };
  try {
    await setSetupMark(clientId, step, done);
    refresh(clientId);
    return { ok: true };
  } catch (error) {
    return fail(error, "setup mark");
  }
}

/** Привязать клиента к одной из организаций, где я участник (или отвязать). */
export async function linkClientOrgAction(clientId: string, orgId: string): Promise<ActionResult> {
  if (!z.uuid().safeParse(clientId).success) return { error: t("agency.errors.invalid") };
  const target = orgId === "" ? null : orgId;
  if (target && !(await getOrganizations()).some((o) => o.id === target))
    return { error: t("agency.errors.invalid") };
  try {
    await linkClientOrg(clientId, target);
    refresh(clientId);
    return { ok: true };
  } catch (error) {
    return fail(error, "link org");
  }
}

/** «Otwórz CRM klienta»: переключает текущую организацию на организацию клиента. */
export async function openClientCrmAction(orgId: string) {
  await requireUser();
  if (!(await getOrganizations()).some((o) => o.id === orgId)) return;
  (await cookies()).set(ORG_COOKIE, orgId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: 31536000,
  });
  redirect("/dzisiaj");
}

/** Кнопка в карточке лида на этапе «Klient»: клиент агентства из лида. */
export async function clientFromLeadAction(leadId: string): Promise<ActionResult> {
  if (!z.uuid().safeParse(leadId).success) return { error: t("agency.errors.invalid") };
  let id: string;
  try {
    id = await clientFromLead(leadId);
  } catch (error) {
    return fail(error, "client from lead");
  }
  refresh(id);
  revalidatePath(`/leady/${leadId}`);
  redirect(`/agencja/klienci/${id}`);
}

export async function addFundExpenseAction(raw: unknown): Promise<ActionResult> {
  const parsed = z
    .object({
      spentOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      category: z.enum(FUND_CATEGORIES),
      label: z.string().trim().min(1).max(200),
      amountGrosze: z.number().int().min(1).max(10_000_000_000),
    })
    .safeParse(raw);
  if (!parsed.success) return { error: t("agency.errors.invalid") };
  try {
    await addFundExpense(parsed.data);
    refresh();
    return { ok: true };
  } catch (error) {
    return fail(error, "fund expense");
  }
}

export async function deleteFundExpenseAction(id: string): Promise<ActionResult> {
  if (!z.uuid().safeParse(id).success) return { error: t("agency.errors.invalid") };
  try {
    await deleteFundExpense(id);
    refresh();
    return { ok: true };
  } catch (error) {
    return fail(error, "fund expense delete");
  }
}

export async function addPayoutAction(raw: unknown): Promise<ActionResult> {
  const parsed = z
    .object({
      userId: z.uuid(),
      month: z.string().regex(/^\d{4}-\d{2}$/),
      amountGrosze: z.number().int().min(1).max(10_000_000_000),
    })
    .safeParse(raw);
  if (!parsed.success) return { error: t("agency.errors.invalid") };
  try {
    await addPayout(parsed.data);
    refresh();
    return { ok: true };
  } catch (error) {
    return fail(error, "payout");
  }
}
