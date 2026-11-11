"use client";

import { useState, useTransition } from "react";
import { Check, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  addFundExpenseAction,
  addPayoutAction,
  deleteFundExpenseAction,
} from "@/lib/agency/actions";
import { parseMoneyField, moneyFieldValue } from "@/lib/agency/schemas";
import { warsawToday } from "@/lib/format";
import { t, type MessageKey } from "@/lib/i18n";

const input = "border-line-strong bg-surface h-10 rounded-lg border px-3 text-[13.5px] lg:h-9";

/** «Wypłać»: записать фактический перевод партнёру за месяц (по умолчанию — остаток к выплате). */
export function PayoutButton({
  userId,
  month,
  remaining,
}: {
  userId: string;
  month: string;
  remaining: number;
}) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(moneyFieldValue(remaining));
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  if (remaining <= 0)
    return <Check className="text-ok ml-auto size-4" aria-label={t("agency.payout.done")} />;
  if (!open)
    return (
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        {t("agency.payout.pay")}
      </Button>
    );
  return (
    <span className="flex items-center justify-end gap-1.5">
      <input
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        inputMode="decimal"
        aria-label={t("agency.payout.amount")}
        className={`${input} w-24 text-right`}
      />
      <Button
        size="sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const grosze = parseMoneyField(amount);
            if (!(grosze > 0)) return setError(t("agency.form.errAmount"));
            const r = await addPayoutAction({ userId, month, amountGrosze: grosze });
            if (r.error) setError(r.error);
            else setOpen(false);
          })
        }
      >
        {t("agency.payout.save")}
      </Button>
      {error ? <span className="text-urgent text-[12px]">{error}</span> : null}
    </span>
  );
}

const CATEGORIES = ["ads", "equipment", "software", "transport", "other"] as const;

/** Расход общего фонда: дата, категория, за что, сумма. */
export function FundExpenseForm() {
  const [spentOn, setSpentOn] = useState(warsawToday());
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>("ads");
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  return (
    <form
      className="grid gap-2 sm:grid-cols-[8.5rem_8.5rem_minmax(0,1fr)_6.5rem_auto]"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const grosze = parseMoneyField(amount);
          if (!label.trim() || !(grosze > 0)) return setError(t("agency.form.errCostRow"));
          const r = await addFundExpenseAction({ spentOn, category, label, amountGrosze: grosze });
          if (r.error) setError(r.error);
          else {
            setLabel("");
            setAmount("");
            setError(undefined);
          }
        });
      }}
    >
      <input
        type="date"
        value={spentOn}
        onChange={(e) => setSpentOn(e.target.value)}
        aria-label={t("agency.fund.date")}
        className={input}
      />
      <select
        value={category}
        onChange={(e) => setCategory(e.target.value as typeof category)}
        aria-label={t("agency.fund.category")}
        className={input}
      >
        {CATEGORIES.map((c) => (
          <option key={c} value={c}>
            {t(`agency.fund.categories.${c}` as MessageKey)}
          </option>
        ))}
      </select>
      <input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder={t("agency.fund.label")}
        aria-label={t("agency.fund.label")}
        maxLength={200}
        className={input}
      />
      <input
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        placeholder="0,00"
        inputMode="decimal"
        aria-label={t("agency.form.costAmount")}
        className={`${input} text-right`}
      />
      <Button type="submit" variant="secondary" disabled={pending}>
        {t("agency.fund.add")}
      </Button>
      {error ? <p className="text-urgent text-[12px] sm:col-span-5">{error}</p> : null}
    </form>
  );
}

export function DeleteExpenseButton({ id, label }: { id: string; label: string }) {
  const [pending, start] = useTransition();
  return (
    <Button
      size="icon"
      variant="ghost"
      disabled={pending}
      aria-label={`${t("agency.form.remove")}: ${label}`}
      onClick={() => start(async () => void (await deleteFundExpenseAction(id)))}
    >
      <Trash2 />
    </Button>
  );
}
