import type { Price } from "@/lib/billing/pricing";
import { formatMoney } from "@/lib/finance/money";
import { t, type MessageKey } from "@/lib/i18n";

const LABEL: Record<string, MessageKey> = {
  leads: "billing.modules.leads",
  channels: "billing.modules.channels",
  documents: "billing.modules.documents",
  payments: "billing.modules.payments",
  calendar: "billing.modules.calendar",
  bundle: "billing.modules.bundle",
  seats: "billing.modules.seats",
};

/** Строки абонемента: netto по строкам, итог netto, VAT 23 %, brutto. */
export function PriceTable({ price }: { price: Price }) {
  return (
    <table className="w-full text-sm tabular-nums" data-testid="price-table">
      <tbody>
        {price.lines.map((l) => (
          <tr key={l.key} className="border-line border-b">
            <td className="py-1.5">
              {t(LABEL[l.key])}
              {l.quantity > 1 ? ` × ${l.quantity}` : ""}
            </td>
            <td className="py-1.5 text-right">
              {l.unitGrosze !== l.listUnitGrosze ? (
                <span className="text-ink-faint mr-2 line-through">
                  {formatMoney(l.listUnitGrosze * l.quantity)}
                </span>
              ) : null}
              {formatMoney(l.totalGrosze)}
            </td>
          </tr>
        ))}
        <tr>
          <td className="pt-2 font-semibold">
            {t("billing.settings.monthly")} {t("billing.settings.net")}
          </td>
          <td className="pt-2 text-right font-semibold">{formatMoney(price.netGrosze)}</td>
        </tr>
        <tr className="text-ink-soft">
          <td>{t("billing.settings.vat")}</td>
          <td className="text-right">{formatMoney(price.vatGrosze)}</td>
        </tr>
        <tr>
          <td className="font-semibold">{t("billing.settings.gross")}</td>
          <td className="text-right text-base font-semibold">{formatMoney(price.grossGrosze)}</td>
        </tr>
      </tbody>
    </table>
  );
}
