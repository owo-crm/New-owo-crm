import type { MessageKey } from "@/lib/i18n";

/**
 * Каталог модулей CRM и цены (netto, гроши, в месяц). Решение 022.
 * Цены — только здесь: расчёт (pricing.ts), Stripe и экраны берут их отсюда.
 * Ключи совпадают с check-ограничением в db/migrations/20261111000021_billing.sql.
 */
export const MODULE_KEYS = ["leads", "channels", "documents", "payments", "calendar"] as const;
export type ModuleKey = (typeof MODULE_KEYS)[number];
/** Модули, которые можно докупить (база leads есть всегда). */
export const ADDON_KEYS = ["channels", "documents", "payments", "calendar"] as const;
export type AddonKey = (typeof ADDON_KEYS)[number];

export type ModuleInfo = {
  key: ModuleKey;
  labelKey: MessageKey;
  descriptionKey: MessageKey;
  priceGrosze: number;
};

export const MODULES: Record<ModuleKey, ModuleInfo> = {
  leads: {
    key: "leads",
    labelKey: "billing.modules.leads",
    descriptionKey: "billing.modules.leadsText",
    priceGrosze: 3900,
  },
  channels: {
    key: "channels",
    labelKey: "billing.modules.channels",
    descriptionKey: "billing.modules.channelsText",
    priceGrosze: 2900,
  },
  documents: {
    key: "documents",
    labelKey: "billing.modules.documents",
    descriptionKey: "billing.modules.documentsText",
    priceGrosze: 5900,
  },
  payments: {
    key: "payments",
    labelKey: "billing.modules.payments",
    descriptionKey: "billing.modules.paymentsText",
    priceGrosze: 2900,
  },
  calendar: {
    key: "calendar",
    labelKey: "billing.modules.calendar",
    descriptionKey: "billing.modules.calendarText",
    priceGrosze: 1900,
  },
};

/** Каждый следующий пользователь сверх включённых. */
export const SEAT_PRICE_GROSZE = 1500;
/** Сколько пользователей входит без доплаты: в базе и в полном пакете. */
export const INCLUDED_SEATS = 1;
export const BUNDLE_INCLUDED_SEATS = 3;
/** «Pakiet Pełny»: все модули. Берётся автоматически, если он дешевле суммы модулей. */
export const BUNDLE_PRICE_GROSZE = 14900;
/** Клиент ведёт у нас рекламу: база бесплатно, модули со скидкой (в базисных пунктах). */
export const AD_CLIENT_ADDON_DISCOUNT_BP = 5000;
/** Ставка VAT для польских фирм (B2B внутри страны). */
export const VAT_RATE_BP = 2300;

/** Какой модуль закрывает какой адрес в CRM клиента (меню + проверка на странице). */
export const MODULE_ROUTES: { prefix: string; module: AddonKey }[] = [
  { prefix: "/dokumenty", module: "documents" },
  { prefix: "/finanse", module: "payments" },
  { prefix: "/kalendarz", module: "calendar" },
];

export function isModuleKey(value: string): value is ModuleKey {
  return (MODULE_KEYS as readonly string[]).includes(value);
}

export function isAddonKey(value: string): value is AddonKey {
  return (ADDON_KEYS as readonly string[]).includes(value);
}
