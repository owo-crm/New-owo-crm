/**
 * Публичные настройки приложения.
 * Название продукта меняется переменной NEXT_PUBLIC_PRODUCT_NAME — без правки кода.
 */
export const appConfig = {
  productName: process.env.NEXT_PUBLIC_PRODUCT_NAME || "OWO CRM",
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL || process.env.SITE_URL || "http://localhost:3000",
  /** Открытая регистрация. По умолчанию выключена: аккаунты клиентам создаёт Owo Ads. */
  registrationOpen: process.env.REGISTRATION_OPEN === "true",
  /** Акцентный цвет по умолчанию, пока фирма не выбрала свой. */
  defaultBrandColor: "#e8000d",
} as const;
