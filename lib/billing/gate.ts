import "server-only";
import { requireOrganization } from "@/lib/auth/session";
import { withOrg } from "@/lib/db/user";
import type { AddonKey } from "./modules";

/**
 * Доступ к модулю в текущем бизнесе. Если модуль выключен — экран показывает ModuleLocked
 * с кнопкой «Poproś o moduł» (requested = заявка уже отправлена).
 */
export async function moduleAccess(module: AddonKey) {
  const { organization } = await requireOrganization();
  if (organization.modules.includes(module)) return { enabled: true, requested: false };
  const requested = await withOrg(async (tx, { organization: org }) => {
    const { rows } = await tx.query(
      "select 1 from public.module_requests where organization_id=$1 and module=$2 and handled_at is null",
      [org.id, module],
    );
    return rows.length > 0;
  });
  return { enabled: false, requested };
}
