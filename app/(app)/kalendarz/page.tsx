import type { Metadata } from "next";
import { ModuleLocked } from "@/components/billing/module-locked";
import { moduleAccess } from "@/lib/billing/gate";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { PageHeader } from "@/components/app-shell/page";
import { MonthCalendar, MonthList } from "@/components/calendar/month";
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
  const raw = (await searchParams).m;
  const month =
    typeof raw === "string" && /^\d{4}-\d{2}$/.test(raw) ? `${raw}-01` : `${today.slice(0, 7)}-01`;
  // Сетка показывает «хвосты» соседних месяцев, поэтому берём неделю до и после.
  const events = await getCalendarEvents(addMonths(month, -1), addMonths(month, 2));
  const [year, m] = month.split("-").map(Number);
  const link = (iso: string) => `/kalendarz?m=${iso.slice(0, 7)}`;
  return (
    <>
      <PageHeader
        title={`${MONTHS[m - 1]} ${year}`}
        subtitle={t("calendar.intro")}
        aside={
          <div className="flex items-center gap-2">
            <Link
              href={link(addMonths(month, -1))}
              aria-label={t("calendar.prev")}
              className={buttonVariants({ variant: "secondary", size: "icon" })}
            >
              <ChevronLeft className="size-4" />
            </Link>
            <Link href="/kalendarz" className={buttonVariants({ variant: "secondary" })}>
              {t("calendar.today")}
            </Link>
            <Link
              href={link(addMonths(month, 1))}
              aria-label={t("calendar.next")}
              className={buttonVariants({ variant: "secondary", size: "icon" })}
            >
              <ChevronRight className="size-4" />
            </Link>
          </div>
        }
      />
      <p className="text-ink-soft mb-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px]">
        <span className="flex items-center gap-2">
          <span className="bg-ok/25 border-ok/50 size-3 rounded border" aria-hidden />
          {t("calendar.confirmed")}
        </span>
        <span className="flex items-center gap-2">
          <span className="border-hold/60 size-3 rounded border border-dashed" aria-hidden />
          {t("calendar.planned")}
        </span>
      </p>
      {events.length === 0 ? (
        <p className="border-line-strong text-ink-soft rounded-2xl border border-dashed px-6 py-12 text-center">
          {t("calendar.emptyMonth")}
        </p>
      ) : (
        <>
          <div className="hidden md:block">
            <MonthCalendar month={month} events={events} today={today} />
          </div>
          <div className="md:hidden">
            <MonthList events={events} />
          </div>
        </>
      )}
    </>
  );
}
