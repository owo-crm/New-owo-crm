"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Briefcase,
  CalendarDays,
  CreditCard,
  FileText,
  Inbox,
  Menu,
  Plus,
  Settings,
  Sun,
  Wallet,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { t, type MessageKey } from "@/lib/i18n";

type Item = { href: string; label: MessageKey; icon: React.ComponentType<{ className?: string }> };

const MAIN: Item[] = [
  { href: "/dzisiaj", label: "nav.today", icon: Sun },
  { href: "/leady", label: "nav.leads", icon: Inbox },
  { href: "/kalendarz", label: "nav.calendar", icon: CalendarDays },
  { href: "/finanse", label: "nav.finance", icon: Wallet },
  { href: "/dokumenty", label: "nav.documents", icon: FileText },
  { href: "/ustawienia", label: "nav.settings", icon: Settings },
];

/** Без модулей в нижней панели — «Abonament»: там можно попросить модуль. */
const SUBSCRIPTION: Item = {
  href: "/ustawienia/abonament",
  label: "billing.settings.title",
  icon: CreditCard,
};

/** Кабинет агентства — только в организации с пресетом agency (решение 021). */
const AGENCY: Item = { href: "/agencja", label: "nav.agency", icon: Briefcase };

/** Пункты, закрытые модулем абонемента (решение 022): без модуля не показываем. */
const MODULE_OF: Partial<Record<string, string>> = {
  "/kalendarz": "calendar",
  "/finanse": "payments",
  "/dokumenty": "documents",
};

function navItems(agency: boolean, modules?: string[]) {
  const visible = MAIN.filter(
    (i) => !modules || !MODULE_OF[i.href] || modules.includes(MODULE_OF[i.href]!),
  );
  return agency ? [visible[0], AGENCY, ...visible.slice(1)] : visible;
}

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(href + "/");
}

/** Боковое меню на компьютере. waiting — сколько лидов ждут ответа (красный значок). */
export function SidebarNav({
  waiting = 0,
  agency = false,
  modules,
}: {
  waiting?: number;
  agency?: boolean;
  modules?: string[];
}) {
  const pathname = usePathname();
  return (
    <nav aria-label="Menu główne" className="grid gap-0.5">
      {navItems(agency, modules).map(({ href, label, icon: Icon }) => {
        const active = isActive(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex h-11 items-center gap-3 rounded-[10px] px-3 text-[15px] transition-colors",
              active
                ? "bg-ink text-bg font-bold"
                : "text-ink-soft hover:bg-surface-2 hover:text-ink font-medium",
            )}
          >
            <Icon className="size-[18px]" />
            <span className="flex-1">{t(label)}</span>
            {href === "/leady" && waiting > 0 ? (
              <span className="bg-urgent rounded-full px-2 py-0.5 text-xs font-bold text-white">
                {waiting}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * Нижняя панель на телефоне: Dzisiaj · Leady · ＋ · Kalendarz · Więcej.
 * «＋» открывает единую форму ручного лида.
 */
export function BottomNav({ agency = false, modules }: { agency?: boolean; modules?: string[] }) {
  const pathname = usePathname();
  const items: (Item | "plus")[] = [
    MAIN[0],
    MAIN[1],
    "plus",
    // У агентства — «Agencja»; у остальных — первый включённый модуль (календарь, финансы, документы).
    agency ? AGENCY : (navItems(false, modules).slice(2, 5)[0] ?? SUBSCRIPTION),
    { href: "/ustawienia", label: "nav.more", icon: Menu },
  ];
  return (
    <nav
      aria-label="Menu główne"
      className="border-line bg-surface fixed inset-x-0 bottom-0 z-30 border-t pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      <ul className="mx-auto grid h-16 max-w-md grid-cols-5 items-center">
        {items.map((item) => {
          if (item === "plus") {
            return (
              <li key="plus" className="flex justify-center">
                <Link
                  href="/leady/nowy"
                  aria-label={t("nav.newLead")}
                  className="bg-urgent flex size-12 items-center justify-center rounded-full text-white"
                >
                  <Plus className="size-6" />
                </Link>
              </li>
            );
          }
          const active = isActive(pathname, item.href);
          const Icon = item.icon;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex flex-col items-center gap-1 py-2 text-[11px] font-bold",
                  active ? "text-ink" : "text-ink-faint",
                )}
              >
                <Icon className="size-[22px]" />
                {t(item.label)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
