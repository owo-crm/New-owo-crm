import type { Metadata } from "next";
import { ModuleLocked } from "@/components/billing/module-locked";
import { moduleAccess } from "@/lib/billing/gate";
import Link from "next/link";
import { PageHeader } from "@/components/app-shell/page";
import { LeadViewTabs } from "@/components/leads/view-tabs";
import { Agenda } from "@/components/calendar/agenda";
import { buttonVariants } from "@/components/ui/button";
import { getCalendarEvents } from "@/lib/leads/dashboard";
import { addMonths, warsawToday } from "@/lib/format";
import { t } from "@/lib/i18n";

export const metadata: Metadata = { title: t("calendar.title") };

const MONTHS = [
  "styczeń",
  "luty",
  "marzec",
  "kwiecień",
  "maj",
  "czerwiec",
  "lipiec",
  "sierpień",
  "wrzesień",
  "październik",
  "listopad",
  "grudzień",
];

export default async function CalendarPage({ searchParams }: PageProps<"/kalendarz">) {
  // Модуль абонемента выключен → экран «Poproś o moduł» (решение 022).
  const access = await moduleAccess("calendar");
  if (!access.enabled)
    return (
      <>
        <PageHeader title={t("calendar.title")} />
        <ModuleLocked module="calendar" requested={access.requested} />
      </>
    );
  const today = warsawToday();
  // Список дат, а не сетка месяца: берём год вперёд, а прошедшее — по запросу.
  const past = (await searchParams).past === "1";
  const events = await getCalendarEvents(
    past ? addMonths(`${today.slice(0, 7)}-01`, -12) : today,
    addMonths(`${today.slice(0, 7)}-01`, 13),
  );
  return (
    <>
      <PageHeader
        title={t("calendar.title")}
        aside={
          <Link
            href={past ? "/kalendarz" : "/kalendarz?past=1"}
            className={buttonVariants({ variant: "secondary" })}
          >
            {t(past ? "calendar.onlyAhead" : "calendar.showPast")}
          </Link>
        }
      />
      <div className="mb-4">
        <LeadViewTabs current="calendar" listHref="/leady" boardHref="/leady?view=board" calendar />
      </div>
      <p className="text-ink-soft mb-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px]">
        <span className="flex items-center gap-2">
          <span className="bg-ok size-3 rounded-[3px]" aria-hidden />
          {t("calendar.confirmed")}
        </span>
        <span className="flex items-center gap-2">
          <span className="bg-hold size-3 rounded-[3px]" aria-hidden />
          {t("calendar.planned")}
        </span>
      </p>
      <Agenda events={events} today={today} />
    </>
  );
}
