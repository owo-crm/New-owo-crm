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
    <nav aria-label={t("nav.agency")} className="border-line flex gap-1 border-b">
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
