"use server";
import { withOrg } from "@/lib/db/user";
import { one } from "@/lib/db";
import { pushSubscriptionSchema } from "./push";
import { t } from "@/lib/i18n";
export async function subscribePush(input: unknown) {
  const parsed = pushSubscriptionSchema.safeParse(input);
  if (!parsed.success) return { error: t("pwa.failed") };
  try {
    await withOrg(async (tx, { user, organization }) => {
      const existing = await one<{ id: string }>(
        tx,
        "select id from public.push_subscriptions where user_id=$1 and organization_id=$2 and endpoint=$3",
        [user.id, organization.id, parsed.data.endpoint],
      );
      if (existing)
        await tx.query("update public.push_subscriptions set keys=$1 where id=$2", [
          parsed.data.keys,
          existing.id,
        ]);
      else
        await tx.query(
          "insert into public.push_subscriptions (organization_id,user_id,endpoint,keys) values ($1,$2,$3,$4)",
          [organization.id, user.id, parsed.data.endpoint, parsed.data.keys],
        );
    });
    return { ok: true };
  } catch {
    return { error: t("pwa.failed") };
  }
}
export async function unsubscribePush(endpoint: string) {
  try {
    await withOrg((tx, { user, organization }) =>
      tx.query(
        "delete from public.push_subscriptions where user_id=$1 and organization_id=$2 and endpoint=$3",
        [user.id, organization.id, endpoint],
      ),
    );
    return { ok: true };
  } catch {
    return { error: t("pwa.failed") };
  }
}
