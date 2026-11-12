import {
  BarChart3,
  Bell,
  Briefcase,
  CalendarDays,
  CreditCard,
  FileSignature,
  Inbox,
  LayoutDashboard,
  Layers,
  PlugZap,
  Settings,
  Upload,
  Users,
} from "lucide-react";
import type { MessageKey } from "@/lib/i18n";

/**
 * Навигация (решение 032): все разделы видны сразу, по группам — Praca · Pieniądze · Firma.
 * Ничего не прячется в «Ustawienia». Общий модуль для серверной оболочки и клиентского меню.
 */
export type NavItem = {
  href: string;
  label: MessageKey;
  icon: React.ComponentType<{ className?: string }>;
  /** Другие адреса, которые подсвечивают этот пункт. */
  also?: string[];
  /** Подсвечивать только точный адрес (а не вложенные). */
  exact?: boolean;
  /** Модуль абонемента, без которого пункт скрыт. */
  module?: string;
  /** Только для кабинета агентства. */
  agency?: boolean;
  /** Только владелец/админ бизнеса. */
  admin?: boolean;
};

export type NavGroup = { label: MessageKey; items: NavItem[] };

export const DASHBOARD: NavItem = {
  href: "/dzisiaj",
  label: "nav.dashboard",
  icon: LayoutDashboard,
};
export const LEADS: NavItem = { href: "/leady", label: "nav.leads", icon: Inbox };
export const CLIENTS: NavItem = { href: "/klienci", label: "nav.clients", icon: Users };
export const CONTRACTS: NavItem = {
  href: "/umowy",
  label: "nav.contracts",
  icon: FileSignature,
  module: "documents",
};
export const CALENDAR: NavItem = {
  href: "/kalendarz",
  label: "nav.calendar",
  icon: CalendarDays,
  module: "calendar",
};
export const AGENCY: NavItem = {
  href: "/agencja",
  label: "nav.agency",
  icon: Briefcase,
  agency: true,
  also: ["/agencja/klienci", "/agencja/zlecenia"],
  exact: true,
};
export const SERVICES: NavItem = {
  href: "/agencja/uslugi",
  label: "agency.services.title",
  icon: Layers,
  agency: true,
};
export const STATS: NavItem = {
  href: "/statystyka",
  label: "nav.stats",
  icon: BarChart3,
  also: ["/finanse"],
};
export const TEAM: NavItem = { href: "/ustawienia/zespol", label: "settings.team", icon: Users };
export const CHANNELS: NavItem = {
  href: "/ustawienia/zrodla",
  label: "settings.channels",
  icon: PlugZap,
  admin: true,
};
export const NOTIFICATIONS: NavItem = {
  href: "/ustawienia/powiadomienia",
  label: "settings.notifications",
  icon: Bell,
};
export const SUBSCRIPTION: NavItem = {
  href: "/ustawienia/abonament",
  label: "billing.settings.title",
  icon: CreditCard,
};
export const IMPORT: NavItem = {
  href: "/ustawienia/import",
  label: "settings.import",
  icon: Upload,
  admin: true,
};
export const SETTINGS: NavItem = {
  href: "/ustawienia",
  label: "nav.settings",
  icon: Settings,
  exact: true,
};

export const NAV_GROUPS: NavGroup[] = [
  { label: "nav.groupWork", items: [DASHBOARD, LEADS, CLIENTS, CONTRACTS, CALENDAR] },
  { label: "nav.groupMoney", items: [AGENCY, SERVICES, STATS] },
  { label: "nav.groupCompany", items: [TEAM, SUBSCRIPTION, SETTINGS] },
];

/**
 * Экраны, которые открывают редко или один раз при подключении: в боковом меню их нет,
 * они живут внутри «Ustawienia». В поиске ⌘K остаются, чтобы до них можно было дойти сразу.
 */
export const SETTINGS_ONLY: NavItem[] = [CHANNELS, NOTIFICATIONS, IMPORT];

export const NAV_ALL = [...NAV_GROUPS.flatMap((g) => g.items), ...SETTINGS_ONLY];

export type NavContext = { agency: boolean; modules: string[]; admin: boolean };

export function visible(item: NavItem, ctx: NavContext) {
  if (item.agency && !ctx.agency) return false;
  if (item.module && !ctx.modules.includes(item.module)) return false;
  if (item.admin && !ctx.admin) return false;
  return true;
}

/** Плоский список для поиска ⌘K. */
export function navItems(ctx: NavContext) {
  return NAV_ALL.filter((i) => visible(i, ctx));
}
