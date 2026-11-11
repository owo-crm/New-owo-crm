"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { withOrg } from "@/lib/db/user";
import { sqlState } from "@/lib/db";
import { PACKAGE_KEYS } from "./barowo/engine";
import {
  DocumentInputError,
  generateContract,
  generateGuestMenu,
  generateOffer,
  type OfferFormValues,
} from "./service";

export type DocumentFormState = { error?: string; values?: Record<string, string> };

const OFFER_KEYS = [
  "date",
  "guests",
  "venue",
  "hours",
  "price",
  "listPrice",
  "message",
  "service",
  "alcohol",
  "softs",
  "ice",
  "additions",
  "menu",
] as const;

function friendly(error: unknown) {
  if (error instanceof DocumentInputError) return error.message;
  if (sqlState(error) === "40001")
    return "Ktoś właśnie zmienił tego leada. Odśwież stronę i spróbuj ponownie.";
  console.error("[documents]", (error as Error).message);
  return "Nie udało się wygenerować dokumentu. Spróbuj ponownie.";
}

export async function createOfferAction(
  _prev: DocumentFormState,
  form: FormData,
): Promise<DocumentFormState> {
  const leadId = z.uuid().parse(form.get("leadId"));
  const pkg = z.enum(PACKAGE_KEYS).parse(form.get("pkg"));
  const values = Object.fromEntries(
    OFFER_KEYS.map((k) => [k, String(form.get(k) ?? "")]),
  ) as OfferFormValues;
  let number: string;
  try {
    const result = await withOrg((tx, { user, organization }) => {
      if (organization.documentEngine !== "barowo" || !organization.modules.includes("documents"))
        throw new DocumentInputError("Dokumenty nie są włączone dla tej firmy.");
      const contact = [organization.email, organization.phone].filter(Boolean).join("  /  ");
      return generateOffer(
        tx,
        { userId: user.id, orgId: organization.id },
        leadId,
        pkg,
        values,
        contact,
      );
    });
    number = result.number;
  } catch (error) {
    return { error: friendly(error), values };
  }
  revalidatePath(`/leady/${leadId}`);
  redirect(`/leady/${leadId}?dokument=${encodeURIComponent("Oferta " + number)}#dokumenty`);
}

export async function createGuestMenuAction(
  _prev: DocumentFormState,
  form: FormData,
): Promise<DocumentFormState> {
  const leadId = z.uuid().parse(form.get("leadId"));
  const menu = String(form.get("menu") ?? "");
  let number: string;
  try {
    const result = await withOrg((tx, { user, organization }) => {
      if (organization.documentEngine !== "barowo" || !organization.modules.includes("documents"))
        throw new DocumentInputError("Dokumenty nie są włączone dla tej firmy.");
      return generateGuestMenu(tx, { userId: user.id, orgId: organization.id }, leadId, menu);
    });
    number = result.number;
  } catch (error) {
    return { error: friendly(error), values: { menu } };
  }
  revalidatePath(`/leady/${leadId}`);
  redirect(`/leady/${leadId}?dokument=${encodeURIComponent("Menu " + number)}#dokumenty`);
}

const CONTRACT_KEYS = [
  "date",
  "city",
  "guests",
  "hours",
  "clientName",
  "address",
  "price",
] as const;

export async function createContractAction(
  _prev: DocumentFormState,
  form: FormData,
): Promise<DocumentFormState> {
  const leadId = z.uuid().parse(form.get("leadId"));
  const pkg = String(form.get("pkg") ?? "");
  const values = Object.fromEntries(
    CONTRACT_KEYS.map((k) => [k, String(form.get(k) ?? "")]),
  ) as Record<(typeof CONTRACT_KEYS)[number], string>;
  let number: string;
  try {
    const result = await withOrg((tx, { user, organization }) => {
      if (organization.documentEngine !== "barowo" || !organization.modules.includes("documents"))
        throw new DocumentInputError("Dokumenty nie są włączone dla tej firmy.");
      return generateContract(tx, { userId: user.id, orgId: organization.id }, leadId, pkg, values);
    });
    number = result.number;
  } catch (error) {
    return { error: friendly(error), values: { ...values, pkg } };
  }
  revalidatePath(`/leady/${leadId}`);
  redirect(`/leady/${leadId}?dokument=${encodeURIComponent("Umowa " + number)}#dokumenty`);
}
