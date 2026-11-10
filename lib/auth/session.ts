import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { getSessionUser, listOrganizations, type MemberOrganization } from "./repository";

/**
 * Data Access Layer: одно место, где читаем «кто вошёл» и «в какой он фирме».
 * cache() — внутри одного запроса база спрашивается один раз, сколько бы компонентов ни звали.
 */
export const SESSION_COOKIE = "owo_session";
export const ORG_COOKIE = "owo_org";

export type CurrentOrganization = MemberOrganization;

export const getCurrentUser = cache(async () => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return getSessionUser(getDb(), token);
});

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/logowanie");
  return user;
}

export const getOrganizations = cache(async (): Promise<CurrentOrganization[]> => {
  const user = await getCurrentUser();
  if (!user) return [];
  return listOrganizations(getDb(), user.id);
});

/** Текущая фирма: выбранная в переключателе (cookie) или первая. Нет фирмы → экран создания. */
export async function requireOrganization() {
  const user = await requireUser();
  const orgs = await getOrganizations();
  const selected = (await cookies()).get(ORG_COOKIE)?.value;
  const organization = orgs.find((o) => o.id === selected) ?? orgs[0];
  if (!organization) redirect("/firma");
  return { user, organization };
}

export async function requireRole(roles: CurrentOrganization["role"][]) {
  const context = await requireOrganization();
  if (!roles.includes(context.organization.role)) redirect("/dzisiaj");
  return context;
}
