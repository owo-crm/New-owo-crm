import type { Metadata } from "next";
import { CalendarDays } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/app-shell/page";
import { t } from "@/lib/i18n";

export const metadata: Metadata = { title: t("nav.calendar") };

export default function Page() {
  return (
    <>
      <PageHeader title={t("nav.calendar")} />
      <EmptyState
        icon={CalendarDays}
        title={t("calendar.emptyTitle")}
        text={t("calendar.emptyText")}
      />
    </>
  );
}
