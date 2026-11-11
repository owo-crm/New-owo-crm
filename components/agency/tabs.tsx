import Link from "next/link";
import { t, type MessageKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/** Вкладки кабинета агентства: Przegląd · Usługi. */
export function AgencyTabs({ current }: { current: "overview" | "services" }) {
  const tabs: { key: typeof current; href: string; label: MessageKey }[] = [
    { key: "overview", href: "/agencja", label: "agency.tabs.overview" },
    { key: "services", href: "/agencja/uslugi", label: "agency.services.title" },
  ];
  return (
    <nav aria-label={t("nav.agency")} className="bg-surface-2 flex rounded-lg p-0.5">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          aria-current={current === tab.key ? "page" : undefined}
          className={cn(
            "h-8 rounded-md px-3 text-[13px] leading-8 font-medium lg:h-7 lg:leading-7",
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
