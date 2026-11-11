import type { Metadata } from "next";
import { ModuleLocked } from "@/components/billing/module-locked";
import { moduleAccess } from "@/lib/billing/gate";
import { FileText } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/app-shell/page";
import { t } from "@/lib/i18n";

export const metadata: Metadata = { title: t("nav.documents") };

export default async function Page() {
  // Модуль абонемента выключен → экран «Poproś o moduł» (решение 022).
  const access = await moduleAccess("documents");
  if (!access.enabled)
    return (
      <>
        <PageHeader title={t("nav.documents")} />
        <ModuleLocked module="documents" requested={access.requested} />
      </>
    );
  return (
    <>
      <PageHeader title={t("nav.documents")} />
      <EmptyState
        icon={FileText}
        title={t("documents.emptyTitle")}
        text={t("documents.emptyText")}
      />
    </>
  );
}
