/**
 * Договор Barowo: правила contractSnapshot_ / contractTemplateValues_ из Contracts.gs (v48).
 * Задаток 1500 zł (в шаблоне: 500 при подписании + 1000 за 7 дней), доп. час 600, штраф 1500.
 */
export const BAROWO_CONTRACT = { deposit: 1500, extraHour: 600, penalty: 1500 } as const;

export type ContractValues = {
  date: string;
  city: string;
  guests: string;
  hours: string;
  clientName: string;
  address: string;
  price: string;
};

type Parsers = {
  parseDocumentDate_(v: string): Date;
  parseDocumentGuests_(v: string): number;
  parseDocumentHours_(v: string): string;
  parseDocumentMoney_(v: string): number;
  formatDocumentMoney_(v: number): string;
  formatDate(v: Date): string;
};

export function contractSnapshot(
  e: Parsers,
  packageName: string,
  values: ContractValues,
  now = new Date(),
) {
  const eventDate = e.parseDocumentDate_(values.date);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (eventDate < today) throw new Error("Data wydarzenia jest w przeszłości. Popraw datę w CRM.");
  const city = values.city.trim();
  const clientName = values.clientName.trim();
  const address = values.address
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join(", ");
  if (!city || !clientName || !address) throw new Error("Uzupełnij miasto, dane klienta i adres.");
  if (city.length > 120 || clientName.length > 500 || address.length > 500)
    throw new Error("Za długie miasto, dane klienta lub adres.");
  const guests = e.parseDocumentGuests_(values.guests);
  const hours = e.parseDocumentHours_(values.hours);
  const price = e.parseDocumentMoney_(values.price);
  const deposit = BAROWO_CONTRACT.deposit;
  if (price < deposit)
    throw new Error(`Cena umowy musi być co najmniej równa zadatkowi (${deposit} zł).`);
  let depositDate = new Date(eventDate);
  depositDate.setDate(depositDate.getDate() - 7);
  if (depositDate < today) {
    depositDate = new Date(today);
    depositDate.setDate(depositDate.getDate() + 1);
  }
  if (depositDate > eventDate) depositDate = new Date(eventDate);
  return {
    clientName,
    address,
    eventDate: e.formatDate(eventDate),
    city,
    guests,
    hours,
    packageName,
    price,
    deposit,
    balance: Math.round((price - deposit) * 100) / 100,
    depositDate: e.formatDate(depositDate),
    today: e.formatDate(today),
    extraHour: BAROWO_CONTRACT.extraHour,
    penalty: BAROWO_CONTRACT.penalty,
  };
}
export type ContractSnapshot = ReturnType<typeof contractSnapshot>;

export function contractTemplateValues(e: Parsers, s: ContractSnapshot, number: string) {
  return {
    UMOWA_NR: number,
    TODAY: s.today,
    EVENT_DATE: s.eventDate,
    CITY: s.city,
    ZLECENIODAWCA: s.clientName,
    ADDRESS: s.address,
    GUESTS: s.guests,
    PRICE: e.formatDocumentMoney_(s.price),
    BALANCE: e.formatDocumentMoney_(s.balance),
    DEPOSIT: e.formatDocumentMoney_(s.deposit),
    DEPOSIT_DATE: s.depositDate,
    EXTRA_HOUR: e.formatDocumentMoney_(s.extraHour),
    PENALTY: e.formatDocumentMoney_(s.penalty),
    HOURS: s.hours,
    PACKAGE: s.packageName,
  };
}
