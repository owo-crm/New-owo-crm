"use client";
import { useTransition } from "react";
import { Check, Undo2 } from "lucide-react";
import { Card } from "@/components/app-shell/page";
import { Button } from "@/components/ui/button";
import { togglePaymentAction } from "@/lib/finance/actions";
import { formatMoney, type Payment } from "@/lib/finance/money";
import { plDate, warsawToday } from "@/lib/format";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/** Деньги по лиду: что уже пришло, что ждём и что просрочено. */
export function PaymentsCard({ payments }: { payments: Payment[] }) {
  const [pending, start] = useTransition();
  const today = warsawToday();
  const total = payments.reduce((sum, p) => sum + p.amount_grosze, 0);
  const paid = payments.filter((p) => p.paid_at).reduce((sum, p) => sum + p.amount_grosze, 0);

  return (
    <Card title={t("finance.title")}>
      {payments.length === 0 ? (
        <p className="text-ink-soft text-sm">{t("finance.empty")}</p>
      ) : (
        <>
          <p className="text-ink-soft mb-3 text-sm">
            {t("finance.paidOf", { paid: formatMoney(paid), total: formatMoney(total) })}
          </p>
          <ul className="divide-line divide-y">
            {payments.map((p) => {
              const overdue = !p.paid_at && p.due_date && p.due_date < today;
              return (
                <li
                  key={p.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 first:pt-0 last:pb-0"
                >
                  <div className="min-w-0 flex-1">
                    <p className={cn("font-semibold", p.paid_at && "text-ink-soft")}>{p.label}</p>
                    <p
                      className={cn(
                        "text-[13px]",
                        overdue ? "text-urgent font-semibold" : "text-ink-soft",
                      )}
                    >
                      {formatMoney(p.amount_grosze)}
                      {p.due_date
                        ? ` · ${t(overdue ? "finance.wasDue" : "finance.due", { date: plDate(p.due_date) })}`
                        : ""}
                    </p>
                  </div>
                  {p.paid_at ? <span className="badge badge-won">{t("finance.paid")}</span> : null}
                  <Button
                    variant={p.paid_at ? "ghost" : "success"}
                    size="sm"
                    disabled={pending}
                    onClick={() =>
                      start(() => togglePaymentAction(p.id, !p.paid_at).then(() => {}))
                    }
                  >
                    {p.paid_at ? <Undo2 className="size-4" /> : <Check className="size-4" />}
                    {t(p.paid_at ? "finance.undo" : "finance.markPaid")}
                  </Button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Card>
  );
}
