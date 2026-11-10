import "server-only";
import { requireOrganization } from "@/lib/auth/session";
import { asUser, getDb, type Queryable } from "@/lib/db";

type Context = Awaited<ReturnType<typeof requireOrganization>>;

/** Запрос от имени вошедшего пользователя в его текущей фирме (RLS включён). */
export async function withOrg<T>(fn: (tx: Queryable, ctx: Context) => Promise<T>) {
  const ctx = await requireOrganization();
  return asUser(getDb(), ctx.user.id, (tx) => fn(tx, ctx));
}
