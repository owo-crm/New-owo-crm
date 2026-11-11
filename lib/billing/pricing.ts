import {
  ADDON_KEYS,
  AD_CLIENT_ADDON_DISCOUNT_BP,
  BUNDLE_INCLUDED_SEATS,
  BUNDLE_PRICE_GROSZE,
  INCLUDED_SEATS,
  MODULES,
  SEAT_PRICE_GROSZE,
  VAT_RATE_BP,
  type ModuleKey,
} from "./modules";

/**
 * Сколько бизнес платит в месяц. Чистая функция: её зовут экран агентства (живая цена),
 * синхронизация со Stripe (строки подписки) и тесты. Решение 022.
 *
 * Правила:
 * - база «Leady» всегда; модули — по списку;
 * - «Pakiet Pełny» берётся сам, если включены все модули и он дешевле суммы;
 * - места: сверх включённых (1, в пакете 3) — по SEAT_PRICE_GROSZE;
 * - клиент рекламы: база 0, модули и пакет −50 %;
 * - дополнительная скидка discountBp — на всё;
 * - всё в грошах, округление вниз; VAT 23 % сверху (Stripe добавляет налог к счёту сам).
 */
export type PriceInput = {
  modules: ModuleKey[];
  seats: number;
  adClient?: boolean;
  discountBp?: number;
};

export type PriceLine = {
  /** Стабильный ключ строки: по нему синхронизируется строка подписки Stripe. */
  key: "leads" | "channels" | "documents" | "payments" | "calendar" | "bundle" | "seats";
  quantity: number;
  /** Цена за единицу после скидок. */
  unitGrosze: number;
  /** Цена за единицу по прайсу (для показа «было / стало»). */
  listUnitGrosze: number;
  totalGrosze: number;
};

export type Price = {
  lines: PriceLine[];
  netGrosze: number;
  vatGrosze: number;
  grossGrosze: number;
  bundle: boolean;
};

function discounted(amount: number, bp: number) {
  return Math.floor((amount * (10000 - bp)) / 10000);
}

function build(input: PriceInput, bundle: boolean): PriceLine[] {
  const extraBp = Math.min(10000, Math.max(0, Math.trunc(input.discountBp ?? 0)));
  const addonBp = input.adClient ? AD_CLIENT_ADDON_DISCOUNT_BP : 0;
  const lines: PriceLine[] = [];
  const add = (key: PriceLine["key"], listUnit: number, quantity: number, bp: number) => {
    if (quantity <= 0) return;
    // Сначала скидка клиента рекламы, потом дополнительная — обе вниз.
    const unit = discounted(discounted(listUnit, bp), extraBp);
    lines.push({
      key,
      quantity,
      unitGrosze: unit,
      listUnitGrosze: listUnit,
      totalGrosze: unit * quantity,
    });
  };
  if (bundle) {
    add("bundle", BUNDLE_PRICE_GROSZE, 1, addonBp);
  } else {
    // Клиент рекламы: база бесплатно (строка остаётся с нулём — видно, что она есть).
    add("leads", MODULES.leads.priceGrosze, 1, input.adClient ? 10000 : 0);
    for (const k of ADDON_KEYS)
      if (input.modules.includes(k)) add(k, MODULES[k].priceGrosze, 1, addonBp);
  }
  const included = bundle ? BUNDLE_INCLUDED_SEATS : INCLUDED_SEATS;
  add("seats", SEAT_PRICE_GROSZE, Math.max(0, Math.trunc(input.seats) - included), 0);
  return lines;
}

const sum = (lines: PriceLine[]) => lines.reduce((s, l) => s + l.totalGrosze, 0);

export function calculatePrice(input: PriceInput): Price {
  // Пакет возможен, только если включены все модули; берём его, если он выходит дешевле.
  const all = ADDON_KEYS.every((k) => input.modules.includes(k));
  const single = build(input, false);
  const packed = all ? build(input, true) : null;
  const bundle = packed !== null && sum(packed) < sum(single);
  const lines = bundle ? packed : single;
  const netGrosze = sum(lines);
  // VAT считаем от суммы счёта и округляем до гроша (как Stripe — по сумме строк).
  const vatGrosze = Math.round((netGrosze * VAT_RATE_BP) / 10000);
  return { lines, netGrosze, vatGrosze, grossGrosze: netGrosze + vatGrosze, bundle };
}
