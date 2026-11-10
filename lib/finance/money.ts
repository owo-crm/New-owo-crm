/** Общие типы и форматирование денег: используется и на сервере, и в браузере. */
export type Payment = {
  id: string;
  lead_id: string;
  kind: "deposit" | "balance" | "other";
  label: string;
  amount_grosze: number;
  due_date: string | null;
  paid_at: string | null;
  position: number;
};

/** Гроши → «6 500,00 zł». */
export function formatMoney(grosze: number) {
  return new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN" }).format(
    grosze / 100,
  );
}

export function parseMoney(text: string) {
  const clean = text.replace(/\s/g, "").replace(",", ".").replace(/zł$/i, "");
  if (!/^\d{1,8}(\.\d{1,2})?$/.test(clean)) throw new Error("invalid_money");
  return Math.round(Number(clean) * 100);
}
