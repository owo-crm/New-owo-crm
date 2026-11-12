import Link from "next/link";
import { t, type MessageKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/** Вкладки раздела «Leady»: Lista · Etapy · Kalendarz (решение 024). Календарь — если модуль включён. */
export function LeadViewTabs({
  current,
  listHref,
  boardHref,
  calendar,
}: {
  current: "list" | "board" | "calendar";
  listHref: string;
  boardHref: string;
  calendar: boolean;
}) {
  const tabs: { key: typeof current; href: string; label: MessageKey }[] = [
    { key: "list", href: listHref, label: "leads.listView" },
    { key: "board", href: boardHref, label: "leads.boardView" },
    ...(calendar
      ? [{ key: "calendar" as const, href: "/kalendarz", label: "nav.calendar" as MessageKey }]
      : []),
  ];
  return (
    <nav aria-label={t("leads.view")} className="border-line flex gap-1 border-b">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          aria-current={current === tab.key ? "page" : undefined}
          className={cn(
            "-mb-px border-b-2 px-3 pt-1 pb-2.5 text-[13.5px] font-medium transition-colors duration-150",
            current === tab.key
              ? "border-accent text-accent"
              : "text-ink-soft hover:text-ink border-transparent",
          )}
        >
          {t(tab.label)}
        </Link>
      ))}
    </nav>
  );
}
