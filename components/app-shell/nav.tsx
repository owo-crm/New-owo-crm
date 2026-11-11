"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, Plus } from "lucide-react";
import { AGENCY, DASHBOARD, LEADS, NAV_ALL, STATS, navItems, type NavItem } from "./nav-items";
import { cn } from "@/lib/utils";
import { t } from "@/lib/i18n";

function isActive(pathname: string, item: NavItem) {
  return [item.href, ...(item.also ?? [])].some(
    (h) => pathname === h || pathname.startsWith(h + "/"),
  );
}

/** Пункт меню по адресу (иконки нельзя передавать с сервера — ищем пункт здесь). */
export function NavLink({ href, badge }: { href: string; badge?: number }) {
  const pathname = usePathname();
  const item = NAV_ALL.find((i) => i.href === href)!;
  const active = isActive(pathname, item);
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-[13.5px] transition-colors duration-150",
        active
          ? "bg-surface-2 text-ink font-semibold"
          : "text-ink-soft hover:bg-surface-2 hover:text-ink",
      )}
    >
      <Icon className={cn("size-4", active ? "text-ink" : "text-ink-faint")} />
      <span className="flex-1">{t(item.label)}</span>
      {badge ? (
        <span className="bg-urgent min-w-5 rounded-full px-1.5 text-center text-[11px] leading-5 font-semibold text-white">
          {badge}
        </span>
      ) : null}
    </Link>
  );
}

/** Боковое меню на компьютере. waiting — сколько лидов ждут ответа (красный значок). */
export function SidebarNav({
  waiting = 0,
  agency = false,
}: {
  waiting?: number;
  agency?: boolean;
}) {
  return (
    <nav aria-label="Menu główne" className="grid gap-0.5">
      {navItems(agency).map((item) => (
        <NavLink
          key={item.href}
          href={item.href}
          badge={item.href === "/leady" ? waiting : undefined}
        />
      ))}
    </nav>
  );
}

/** Нижняя панель на телефоне: Pulpit · Leady · ＋ · Agencja/Statystyka · Więcej. */
export function BottomNav({ agency = false }: { agency?: boolean }) {
  const pathname = usePathname();
  const items: (NavItem | "plus")[] = [
    DASHBOARD,
    LEADS,
    "plus",
    agency ? AGENCY : STATS,
    { href: "/ustawienia", label: "nav.more", icon: Menu, also: agency ? ["/statystyka"] : [] },
  ];
  return (
    <nav
      aria-label="Menu główne"
      className="border-line bg-surface/95 fixed inset-x-0 bottom-0 z-30 border-t pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
    >
      <ul className="mx-auto grid h-16 max-w-md grid-cols-5 items-center">
        {items.map((item) => {
          if (item === "plus") {
            return (
              <li key="plus" className="flex justify-center">
                <Link
                  href="/leady/nowy"
                  aria-label={t("nav.newLead")}
                  className="bg-ink text-bg flex size-11 items-center justify-center rounded-full transition-transform duration-150 active:scale-[0.96]"
                >
                  <Plus className="size-5" />
                </Link>
              </li>
            );
          }
          const active = isActive(pathname, item);
          const Icon = item.icon;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex flex-col items-center gap-1 py-2 text-[11px] font-medium",
                  active ? "text-ink" : "text-ink-faint",
                )}
              >
                <Icon className="size-5" />
                {t(item.label)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
