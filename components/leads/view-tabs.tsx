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
    <nav aria-label={t("leads.view")} className="bg-surface-2 flex rounded-lg p-0.5">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          aria-current={current === tab.key ? "page" : undefined}
          className={cn(
            "h-8 rounded-md px-3 text-[13px] leading-8 font-medium transition-colors duration-150 lg:h-7 lg:leading-7",
            current === tab.key
              ? "bg-surface text-ink shadow-[var(--shadow)]"
              : "text-ink-soft hover:text-ink",
          )}
        >
          {t(tab.label)}
        </Link>
      ))}
    </nav>
  );
}
