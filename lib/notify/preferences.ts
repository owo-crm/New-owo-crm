"use server";
import { withOrg } from "@/lib/db/user";
import { z } from "zod";
import { t } from "@/lib/i18n";
export async function saveNotificationPreference(channel: string, enabled: boolean) {
  if (
    !z.enum(["telegram", "push", "email"]).safeParse(channel).success ||
    typeof enabled !== "boolean"
  )
    return { error: t("leads.saveError") };
  try {
    await withOrg((tx, { user, organization }) =>
      tx.query(
        "update public.notification_settings set enabled=$1 where organization_id=$2 and user_id=$3 and channel=$4",
        [enabled, organization.id, user.id, channel],
      ),
    );
    return { ok: true };
  } catch {
    return { error: t("leads.saveError") };
  }
}
