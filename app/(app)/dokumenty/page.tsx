import type { Metadata } from "next";
import { FileText } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/app-shell/page";
import { t } from "@/lib/i18n";

export const metadata: Metadata = { title: t("nav.documents") };

export default function Page() {
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
