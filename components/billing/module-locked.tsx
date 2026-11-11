import { Lock } from "lucide-react";
import { EmptyState } from "@/components/app-shell/page";
import { RequestModuleButton } from "@/components/billing/request-module-button";
import { MODULES, type AddonKey } from "@/lib/billing/modules";
import { formatMoney } from "@/lib/finance/money";
import { t } from "@/lib/i18n";

/** Экран выключенного модуля: что это, сколько стоит, «Poproś o moduł». */
export function ModuleLocked({ module, requested }: { module: AddonKey; requested: boolean }) {
  const info = MODULES[module];
  return (
    <EmptyState
      icon={Lock}
      title={t("billing.locked.title", { module: t(info.labelKey) })}
      text={`${t(info.descriptionKey)}. ${t("billing.locked.text")}`}
      action={
        <div className="grid justify-items-center gap-2">
          <p className="text-ink-soft text-sm font-bold">
            {t("billing.locked.price", { amount: formatMoney(info.priceGrosze) })}
          </p>
          <RequestModuleButton module={module} requested={requested} />
        </div>
      }
    />
  );
}
