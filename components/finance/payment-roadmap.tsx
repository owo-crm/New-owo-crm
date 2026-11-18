"use client";
import { Fragment, useTransition } from "react";
import { Check } from "lucide-react";
import { togglePaymentAction } from "@/lib/finance/actions";
import { formatMoney, type Payment } from "@/lib/finance/money";
import { plDate, warsawToday } from "@/lib/format";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * Платежи лида «змейкой» (решение 049): 500 zł → 1000 zł → остаток.
 * Если договор уже сформирован — шаги из него, щелчок по кружку отмечает оплату.
 * Если договора нет — план из настроек бизнеса и бюджет лида (что ждать).
 */
type Step = {
  id?: string;
  label: string;
  amount: number | null;
  due: string | null;
  paid: boolean;
};

export function paymentSteps(
  payments: Payment[],
  plan: number[],
  totalGrosze: number | null,
): Step[] {
  if (payments.length)
    return payments.map((p) => ({
      id: p.id,
      label: p.label,
      amount: p.amount_grosze,
      due: p.due_date,
      paid: Boolean(p.paid_at),
    }));
  const steps: Step[] = plan.map((amount, i) => ({
    label: plan.length === 1 ? t("finance.stepDeposit") : t("finance.stepN", { n: i + 1 }),
    amount,
    due: null,
    paid: false,
  }));
  const rest = totalGrosze === null ? null : totalGrosze - plan.reduce((a, b) => a + b, 0);
  if (rest === null || rest > 0)
    steps.push({ label: t("finance.stepRest"), amount: rest, due: null, paid: false });
  return steps;
}

const PER_ROW = 3;

export function PaymentRoadmap({
  payments,
  plan,
  totalGrosze,
}: {
  payments: Payment[];
  plan: number[];
  totalGrosze: number | null;
}) {
  const [pending, start] = useTransition();
  const today = warsawToday();
  const steps = paymentSteps(payments, plan, totalGrosze);
  const nextIndex = steps.findIndex((s) => !s.paid);
  const rows: Step[][] = [];
  for (let i = 0; i < steps.length; i += PER_ROW) rows.push(steps.slice(i, i + PER_ROW));
  const paid = steps.filter((s) => s.paid).reduce((sum, s) => sum + (s.amount ?? 0), 0);
  const total = steps.every((s) => s.amount !== null)
    ? steps.reduce((sum, s) => sum + (s.amount ?? 0), 0)
    : null;

  return (
    <div className="grid gap-2">
      <p className="text-ink-soft text-[12.5px]">
        {payments.length
          ? t("finance.paidOf", {
              paid: formatMoney(paid),
              total: total !== null ? formatMoney(total) : "—",
            })
          : t("finance.planned")}
      </p>
      <ol className="grid gap-1">
        {rows.map((row, r) => (
          <Fragment key={r}>
            {r > 0 ? (
              // Поворот змейки: вертикальная связка у края, где закончилась строка.
              <li
                aria-hidden
                className={cn(
                  "flex h-4 px-[calc((100%/3-2rem)/2+0.95rem)]",
                  r % 2 ? "justify-end" : "justify-start",
                )}
              >
                <span
                  className={cn(
                    "w-0.5 rounded-full",
                    rows[r - 1].every((s) => s.paid) ? "bg-ok" : "bg-line-strong",
                  )}
                />
              </li>
            ) : null}
            <li className={cn("flex items-start", r % 2 && "flex-row-reverse")}>
              {row.map((step, i) => {
                const index = r * PER_ROW + i;
                const current = index === nextIndex;
                const overdue = !step.paid && step.due && step.due < today;
                return (
                  <Fragment key={index}>
                    {i > 0 ? (
                      <span
                        aria-hidden
                        className={cn(
                          "mt-[15px] h-0.5 min-w-3 flex-1 rounded-full",
                          steps[index - 1].paid ? "bg-ok" : "bg-line-strong",
                        )}
                      />
                    ) : null}
                    <div className="flex w-[calc((100%-1.5rem)/3)] min-w-0 flex-col items-center text-center">
                      <button
                        type="button"
                        disabled={!step.id || pending}
                        title={
                          step.id ? t(step.paid ? "finance.undo" : "finance.markPaid") : undefined
                        }
                        onClick={() =>
                          step.id &&
                          start(() => togglePaymentAction(step.id!, !step.paid).then(() => {}))
                        }
                        className={cn(
                          "flex size-8 items-center justify-center rounded-full border-2 text-[12.5px] font-bold transition-colors",
                          step.paid
                            ? "border-ok bg-ok text-white"
                            : current
                              ? overdue
                                ? "border-urgent text-urgent ring-urgent/15 ring-4"
                                : "border-accent text-accent ring-accent/15 ring-4"
                              : "border-line-strong text-ink-faint bg-surface",
                          step.id && "hover:scale-105",
                        )}
                      >
                        {step.paid ? <Check className="size-4" /> : index + 1}
                      </button>
                      <span className="mt-1.5 text-[13.5px] font-bold tabular-nums">
                        {step.amount === null
                          ? "—"
                          : formatMoney(step.amount).replace(/,00(?=\s)/, "")}
                      </span>
                      <span className="text-ink-soft line-clamp-2 text-[11.5px] leading-tight">
                        {step.label}
                      </span>
                      {step.due ? (
                        <span
                          className={cn(
                            "text-[11px]",
                            overdue ? "text-urgent font-semibold" : "text-ink-faint",
                          )}
                        >
                          {plDate(step.due)}
                        </span>
                      ) : null}
                    </div>
                  </Fragment>
                );
              })}
            </li>
          </Fragment>
        ))}
      </ol>
    </div>
  );
}
