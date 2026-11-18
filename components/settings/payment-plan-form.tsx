"use client";
import { useState, useTransition } from "react";
import { Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { savePaymentPlanAction } from "@/lib/finance/actions";
import { t } from "@/lib/i18n";

/** Сколько предоплат и какие суммы (решение 049). Остаток до полной цены считается сам. */
export function PaymentPlanForm({ plan, canEdit }: { plan: number[]; canEdit: boolean }) {
  const [amounts, setAmounts] = useState(plan.map((g) => String(g / 100)));
  const [note, setNote] = useState<{ text: string; bad?: boolean }>();
  const [pending, start] = useTransition();
  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await savePaymentPlanAction(amounts);
          setNote(r.error ? { text: r.error, bad: true } : { text: t("paymentPlan.saved") });
        });
      }}
    >
      <ol className="grid gap-2">
        {amounts.map((value, i) => (
          <li key={i} className="flex items-center gap-2">
            <span className="text-ink-soft w-28 shrink-0 text-[13.5px]">
              {t("finance.stepN", { n: i + 1 })}
            </span>
            <input
              value={value}
              inputMode="decimal"
              disabled={!canEdit}
              onChange={(e) => setAmounts(amounts.map((a, j) => (j === i ? e.target.value : a)))}
              aria-label={t("finance.stepN", { n: i + 1 })}
              className="border-line-strong bg-surface h-10 w-32 rounded-lg border px-3 text-[14px]"
            />
            <span className="text-ink-faint text-[13px]">zł</span>
          </li>
        ))}
        <li className="text-ink-soft flex items-center gap-2 text-[13.5px]">
          <span className="w-28 shrink-0">{t("finance.stepRest")}</span>
          {t("paymentPlan.rest")}
        </li>
      </ol>
      {canEdit ? (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={amounts.length >= 5}
            onClick={() => setAmounts([...amounts, ""])}
          >
            <Plus />
            {t("paymentPlan.add")}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={!amounts.length}
            onClick={() => setAmounts(amounts.slice(0, -1))}
          >
            <Minus />
            {t("paymentPlan.remove")}
          </Button>
          <Button type="submit" size="sm" disabled={pending} className="ml-auto">
            {t("leads.save")}
          </Button>
        </div>
      ) : null}
      {note ? (
        <p role="status" className={note.bad ? "text-urgent text-[13px]" : "text-ok text-[13px]"}>
          {note.text}
        </p>
      ) : null}
    </form>
  );
}
