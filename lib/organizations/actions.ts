"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { asUser, one } from "@/lib/db";
import { getDb } from "@/lib/db";
import { requireUser, ORG_COOKIE } from "@/lib/auth/session";
import { createOrganizationSchema, fieldErrors, type FieldErrors } from "@/lib/auth/schemas";
import { slugify } from "@/lib/organizations/slug";
import { t } from "@/lib/i18n";

export type CreateOrgState = { errors?: FieldErrors; message?: string; name?: string };

/** Создаёт фирму; создатель становится владельцем (функция create_organization в базе). */
export async function createOrganization(
  _prev: CreateOrgState,
  formData: FormData,
): Promise<CreateOrgState> {
  const user = await requireUser();
  const parsed = createOrganizationSchema.safeParse(Object.fromEntries(formData));
  const name = String(formData.get("name") ?? "");
  if (!parsed.success) return { errors: fieldErrors(parsed.error), name };

  let orgId: string;
  try {
    const row = await asUser(getDb(), user.id, (tx) =>
      one<{ id: string }>(tx, "select public.create_organization($1, $2, $3) as id", [
        parsed.data.name,
        slugify(parsed.data.name),
        parsed.data.preset,
      ]),
    );
    orgId = row!.id;
    // Пока регистрация открыта для Barowo: новая фирма сразу получает генератор документов.
    if (process.env.DEFAULT_DOCUMENT_ENGINE)
      await getDb().query(
        "update public.organizations set document_engine=$1 where id=$2 and document_engine is null",
        [process.env.DEFAULT_DOCUMENT_ENGINE, orgId],
      );
  } catch (error) {
    console.error("[org] create", (error as Error).message);
    return { message: t("common.unknownError"), name };
  }
  (await cookies()).set(ORG_COOKIE, orgId, { httpOnly: true, sameSite: "lax", path: "/" });
  redirect("/dzisiaj");
}
