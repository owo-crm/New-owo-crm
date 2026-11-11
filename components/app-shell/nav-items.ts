import { BarChart3, Briefcase, Inbox, LayoutDashboard, Settings } from "lucide-react";
import type { MessageKey } from "@/lib/i18n";

/**
 * Навигация (решение 024): Pulpit · Leady · Agencja (только у OWO Ads) · Statystyka · Ustawienia.
 * Календарь — вкладка в «Leady», финансы — в «Statystyka», документы — в карточке лида.
 * Общий модуль: им пользуются и серверная оболочка, и клиентское меню.
 */
export type NavItem = {
  href: string;
  label: MessageKey;
  icon: React.ComponentType<{ className?: string }>;
  /** Другие адреса, которые подсвечивают этот пункт. */
  also?: string[];
};

export const DASHBOARD: NavItem = {
  href: "/dzisiaj",
  label: "nav.dashboard",
  icon: LayoutDashboard,
};
export const LEADS: NavItem = {
  href: "/leady",
  label: "nav.leads",
  icon: Inbox,
  also: ["/kalendarz"],
};
export const AGENCY: NavItem = { href: "/agencja", label: "nav.agency", icon: Briefcase };
export const STATS: NavItem = {
  href: "/statystyka",
  label: "nav.stats",
  icon: BarChart3,
  also: ["/finanse"],
};
export const SETTINGS: NavItem = { href: "/ustawienia", label: "nav.settings", icon: Settings };

export function navItems(agency: boolean): NavItem[] {
  return agency ? [DASHBOARD, LEADS, AGENCY, STATS] : [DASHBOARD, LEADS, STATS];
}

export const NAV_ALL = [DASHBOARD, LEADS, AGENCY, STATS, SETTINGS];
