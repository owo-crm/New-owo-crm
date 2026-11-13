"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { BarChart3, Briefcase, Inbox, LayoutDashboard, Menu, Plus, X } from "lucide-react";
import { NAV_ALL, NAV_GROUPS, visible, type NavContext, type NavItem } from "./nav-items";
import { cn } from "@/lib/utils";
import { t } from "@/lib/i18n";

function isActive(pathname: string, item: NavItem) {
  if (pathname === item.href) return true;
  if (!item.exact && pathname.startsWith(item.href + "/")) return true;
  return (item.also ?? []).some((h) => pathname === h || pathname.startsWith(h + "/"));
}

/** Пункт меню по адресу (иконки нельзя передавать с сервера — ищем пункт здесь). */
export function NavLink({
  href,
  badge,
  onNavigate,
}: {
  href: string;
  badge?: number;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const item = NAV_ALL.find((i) => i.href === href)!;
  const active = isActive(pathname, item);
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      title={t(item.label)}
      className={cn(
        "relative flex h-10 items-center gap-3 rounded-xl px-3 text-[14px] transition-colors duration-150 lg:h-9 lg:group-data-[nav=rail]/shell:justify-center lg:group-data-[nav=rail]/shell:px-0",
        active
          ? "bg-accent/10 text-accent font-semibold"
          : "text-ink-soft hover:bg-surface-2 hover:text-ink",
      )}
    >
      <Icon className={cn("size-[18px] shrink-0", active ? "text-accent" : "text-ink-faint")} />
      <span className="min-w-0 flex-1 truncate lg:group-data-[nav=rail]/shell:hidden">
        {t(item.label)}
      </span>
      {badge ? (
        <span className="bg-urgent min-w-5 rounded-full px-1.5 text-center text-[11px] leading-5 font-semibold text-white lg:group-data-[nav=rail]/shell:absolute lg:group-data-[nav=rail]/shell:-top-1 lg:group-data-[nav=rail]/shell:right-0 lg:group-data-[nav=rail]/shell:min-w-4 lg:group-data-[nav=rail]/shell:px-1 lg:group-data-[nav=rail]/shell:text-[10px] lg:group-data-[nav=rail]/shell:leading-4">
          {badge}
        </span>
      ) : null}
    </Link>
  );
}

/** Меню группами: Praca · Pieniądze · Firma. Пустые группы не показываются. */
export function GroupedNav({
  ctx,
  waiting = 0,
  onNavigate,
}: {
  ctx: NavContext;
  waiting?: number;
  onNavigate?: () => void;
}) {
  return (
    <nav aria-label="Menu główne" className="grid gap-5">
      {NAV_GROUPS.map((group) => {
        const items = group.items.filter((i) => visible(i, ctx));
        if (!items.length) return null;
        return (
          <div key={group.label} className="grid gap-0.5">
            <p className="text-ink-faint mb-1 px-3 text-[12px] font-medium lg:group-data-[nav=rail]/shell:hidden">
              {t(group.label)}
            </p>
            {items.map((item) => (
              <NavLink
                key={item.href}
                href={item.href}
                badge={item.href === "/leady" ? waiting : undefined}
                onNavigate={onNavigate}
              />
            ))}
          </div>
        );
      })}
    </nav>
  );
}

/**
 * Нижняя панель на телефоне: Pulpit · Leady · ＋ · Agencja/Statystyka · Menu.
 * «Menu» открывает шторку со всеми разделами — те же группы, что на компьютере.
 */
export function BottomNav({ ctx, waiting = 0 }: { ctx: NavContext; waiting?: number }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);
  const fourth = ctx.agency
    ? { href: "/agencja", label: t("nav.agency"), icon: Briefcase }
    : { href: "/statystyka", label: t("nav.stats"), icon: BarChart3 };
  const tabs = [
    { href: "/dzisiaj", label: t("nav.dashboard"), icon: LayoutDashboard },
    { href: "/leady", label: t("nav.leads"), icon: Inbox },
    null,
    fourth,
  ];
  return (
    <>
      <nav
        aria-label="Menu główne"
        className="border-line bg-surface/95 fixed inset-x-0 bottom-0 z-30 border-t pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
      >
        <ul className="mx-auto grid h-16 w-full max-w-md grid-cols-5 items-center">
          {tabs.map((tab) =>
            tab === null ? (
              <li key="plus" className="flex justify-center">
                <Link
                  href="/leady/nowy"
                  aria-label={t("nav.newLead")}
                  className="bg-accent text-accent-ink flex size-11 items-center justify-center rounded-full shadow-[var(--shadow-pop)] transition-transform duration-150 active:scale-[0.96]"
                >
                  <Plus className="size-5" />
                </Link>
              </li>
            ) : (
              <li key={tab.href} className="min-w-0">
                <Link
                  href={tab.href}
                  aria-current={pathname.startsWith(tab.href) ? "page" : undefined}
                  className={cn(
                    "relative flex flex-col items-center gap-1 py-2 text-[11px] font-medium",
                    pathname.startsWith(tab.href) ? "text-accent" : "text-ink-faint",
                  )}
                >
                  <tab.icon className="size-5" />
                  <span className="max-w-full truncate px-1">{tab.label}</span>
                  {tab.href === "/leady" && waiting ? (
                    <span className="bg-urgent absolute top-1 left-1/2 ml-2 min-w-4 rounded-full px-1 text-center text-[10px] leading-4 font-semibold text-white">
                      {waiting}
                    </span>
                  ) : null}
                </Link>
              </li>
            ),
          )}
          <li className="min-w-0">
            <button
              type="button"
              onClick={() => setOpen(true)}
              aria-expanded={open}
              className="text-ink-faint flex w-full flex-col items-center gap-1 py-2 text-[11px] font-medium"
            >
              <Menu className="size-5" />
              {t("nav.menu")}
            </button>
          </li>
        </ul>
      </nav>
      {open ? (
        <div
          className="fixed inset-0 z-50 lg:hidden"
          role="dialog"
          aria-modal="true"
          aria-label={t("nav.menu")}
        >
          <button
            type="button"
            aria-label={t("common.close")}
            className="absolute inset-0 bg-black/30"
            onClick={() => setOpen(false)}
          />
          <div className="bg-surface absolute inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto rounded-t-2xl px-3 pt-3 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-[var(--shadow-pop)]">
            <div className="mb-2 flex items-center justify-between px-3">
              <span className="bg-line-strong mx-auto h-1 w-10 rounded-full" aria-hidden />
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={t("common.close")}
                className="text-ink-faint absolute right-4 flex size-9 items-center justify-center rounded-lg"
              >
                <X className="size-5" />
              </button>
            </div>
            <GroupedNav ctx={ctx} waiting={waiting} onNavigate={() => setOpen(false)} />
          </div>
        </div>
      ) : null}
    </>
  );
}
