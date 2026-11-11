"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { Card } from "@/components/app-shell/page";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { saveOrderAction } from "@/lib/agency/actions";
import {
  ORDER_KINDS,
  ORDER_STATUSES,
  moneyFieldValue,
  parseHours,
  parseMoneyField,
  type OrderKind,
  type OrderStatus,
} from "@/lib/agency/schemas";
import {
  sharePercent,
  splitBase,
  splitOrder,
  totalsBySplit,
  type Shares,
} from "@/lib/agency/split";
import { formatMoney } from "@/lib/finance/money";
import { t, type MessageKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type Option = { id: string; name: string };
type Member = { userId: string; name: string };

export type OrderFormInitial = {
  id?: string;
  clientId: string;
  title: string;
  kind: OrderKind;
  amountGrosze: number;
  directCostsGrosze: number;
  adBudgetGrosze: number;
  soldBy: string | null;
  periodMonth: string;
  status: OrderStatus;
  dueDate: string | null;
  note: string;
  work: { userId: string; hours: number; note: string }[];
};

type WorkRow = { key: number; userId: string; hours: string };

const selectClass =
  "h-10 w-full rounded-[10px] border border-line-strong bg-surface px-3 text-sm text-ink hover:border-ink-soft focus:border-ink focus:outline-none aria-invalid:border-urgent";

function Select({
  label,
  hint,
  error,
  children,
  ...props
}: React.ComponentProps<"select"> & { label: string; hint?: string; error?: string }) {
  return (
    <label className="grid gap-1.5 text-sm font-semibold">
      {label}
      <select className={selectClass} aria-invalid={error ? true : undefined} {...props}>
        {children}
      </select>
      {error ? (
        <span className="text-urgent font-normal">{error}</span>
      ) : hint ? (
        <span className="text-ink-soft font-normal">{hint}</span>
      ) : null}
    </label>
  );
}

/**
 * Форма заказа агентства. Главное здесь — блок «Podział»: он пересчитывается на каждый ввод
 * той же формулой, что и база (lib/agency/split.ts), чтобы человек видел свою долю до сохранения.
 */
export function OrderForm({
  initial,
  clients,
  members,
  shares,
  currentUserId,
}: {
  initial: OrderFormInitial;
  clients: Option[];
  members: Member[];
  shares: Shares;
  currentUserId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();
  const [submitted, setSubmitted] = useState(false);

  const [clientId, setClientId] = useState(initial.clientId);
  const [title, setTitle] = useState(initial.title);
  const [kind, setKind] = useState<OrderKind>(initial.kind);
  const [amount, setAmount] = useState(moneyFieldValue(initial.amountGrosze));
  const [costs, setCosts] = useState(moneyFieldValue(initial.directCostsGrosze));
  const [adBudget, setAdBudget] = useState(moneyFieldValue(initial.adBudgetGrosze));
  const [soldBy, setSoldBy] = useState(initial.soldBy ?? "");
  const [periodMonth, setPeriodMonth] = useState(initial.periodMonth);
  const [status, setStatus] = useState<OrderStatus>(initial.status);
  const [dueDate, setDueDate] = useState(initial.dueDate ?? "");
  const [note, setNote] = useState(initial.note);
  const [work, setWork] = useState<WorkRow[]>(() =>
    initial.work.map((w, i) => ({
      key: i,
      userId: w.userId,
      hours: String(w.hours).replace(".", ","),
    })),
  );
  const [nextKey, setNextKey] = useState(initial.work.length);

  const amountGrosze = parseMoneyField(amount);
  const costsGrosze = parseMoneyField(costs);
  const adGrosze = parseMoneyField(adBudget);
  const hours = work.map((w) => parseHours(w.hours));
  const duplicate = new Set(work.map((w) => w.userId)).size !== work.length;

  const errors: Record<string, string | undefined> = {
    clientId: clientId ? undefined : t("agency.form.errClient"),
    title: title.trim() ? undefined : t("agency.form.errTitle"),
    amount: Number.isNaN(amountGrosze) ? t("agency.form.errAmount") : undefined,
    costs: Number.isNaN(costsGrosze)
      ? t("agency.form.errAmount")
      : costsGrosze > (Number.isNaN(amountGrosze) ? 0 : amountGrosze)
        ? t("agency.form.errCosts")
        : undefined,
    adBudget: Number.isNaN(adGrosze) ? t("agency.form.errAmount") : undefined,
    work: duplicate ? t("agency.form.errWorker") : undefined,
  };
  const hourErrors = hours.map((h) =>
    Number.isNaN(h) || h <= 0 || h > 500 ? t("agency.form.errHours") : undefined,
  );
  const valid = Object.values(errors).every((e) => !e) && hourErrors.every((e) => !e);
  const show = (key: string) => (submitted ? errors[key] : undefined);

  // Живой расчёт: неверные поля считаем нулём, чтобы превью не «прыгало» в ошибку.
  const preview = (() => {
    const a = Number.isNaN(amountGrosze) ? 0 : amountGrosze;
    const c = Number.isNaN(costsGrosze) ? 0 : Math.min(costsGrosze, a);
    const lines = splitOrder(
      {
        amountGrosze: a,
        directCostsGrosze: c,
        soldBy: soldBy || null,
        work: work
          .map((w, i) => ({ userId: w.userId, hours: hours[i] }))
          .filter((w) => w.hours > 0 && w.hours <= 500),
      },
      shares,
    );
    return {
      base: splitBase({ amountGrosze: a, directCostsGrosze: c }),
      totals: totalsBySplit(lines),
    };
  })();

  const nameOf = (id: string) => members.find((m) => m.userId === id)?.name ?? "—";
  const mine = preview.totals.people.find((p) => p.userId === currentUserId);
  const freeMembers = (current: string) =>
    members.filter((m) => m.userId === current || !work.some((w) => w.userId === m.userId));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    if (!valid) return;
    startTransition(async () => {
      setError(undefined);
      const result = await saveOrderAction({
        id: initial.id,
        clientId,
        title,
        kind,
        amountGrosze,
        directCostsGrosze: costsGrosze,
        adBudgetGrosze: adGrosze,
        soldBy: soldBy || null,
        periodMonth,
        status,
        dueDate: dueDate || null,
        note,
        work: work.map((w, i) => ({ userId: w.userId, hours: hours[i], note: "" })),
      });
      if (result.ok) {
        router.push(`/agencja/klienci/${clientId}`);
        router.refresh();
      } else setError(result.error);
    });
  }

  return (
    <form
      noValidate
      onSubmit={submit}
      className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]"
    >
      <div className="grid gap-5">
        <Card>
          {error ? (
            <p role="alert" className="text-urgent mb-4">
              {error}
            </p>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              label={t("agency.form.client")}
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              error={show("clientId")}
              disabled={pending}
              name="clientId"
            >
              <option value="">{t("agency.form.clientPick")}</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
            <Select
              label={t("agency.form.kind")}
              value={kind}
              onChange={(e) => setKind(e.target.value as OrderKind)}
              disabled={pending}
              name="kind"
            >
              {ORDER_KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`agency.kind.${k}` as MessageKey)}
                </option>
              ))}
            </Select>
            <Field
              className="sm:col-span-2"
              label={t("agency.form.title")}
              hint={t("agency.form.titleHint")}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              error={show("title")}
              maxLength={200}
              disabled={pending}
              name="title"
            />
            <Field
              label={t("agency.form.amount")}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              error={show("amount") ?? (amount && errors.amount ? errors.amount : undefined)}
              inputMode="decimal"
              placeholder="0"
              disabled={pending}
              name="amount"
            />
            <Field
              label={t("agency.form.costs")}
              hint={t("agency.form.costsHint")}
              value={costs}
              onChange={(e) => setCosts(e.target.value)}
              error={errors.costs && (submitted || costs) ? errors.costs : undefined}
              inputMode="decimal"
              placeholder="0"
              disabled={pending}
              name="costs"
            />
            <Field
              label={t("agency.form.adBudget")}
              hint={t("agency.form.adBudgetHint")}
              value={adBudget}
              onChange={(e) => setAdBudget(e.target.value)}
              error={errors.adBudget && (submitted || adBudget) ? errors.adBudget : undefined}
              inputMode="decimal"
              placeholder="0"
              disabled={pending}
              name="adBudget"
            />
            <Select
              label={t("agency.form.soldBy")}
              value={soldBy}
              onChange={(e) => setSoldBy(e.target.value)}
              disabled={pending}
              name="soldBy"
            >
              <option value="">{t("agency.form.nobody")}</option>
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.name}
                </option>
              ))}
            </Select>
          </div>
        </Card>

        <Card title={t("agency.form.work")}>
          <p className="text-ink-soft -mt-1 mb-4 text-sm">{t("agency.form.workHint")}</p>
          <ul className="grid gap-3" aria-label={t("agency.form.work")}>
            {work.map((row, i) => (
              <li
                key={row.key}
                className="grid grid-cols-[minmax(0,1fr)_6.5rem_2.75rem] items-end gap-2"
              >
                <Select
                  label={t("agency.form.worker")}
                  value={row.userId}
                  onChange={(e) =>
                    setWork(
                      work.map((w) => (w.key === row.key ? { ...w, userId: e.target.value } : w)),
                    )
                  }
                  disabled={pending}
                >
                  {freeMembers(row.userId).map((m) => (
                    <option key={m.userId} value={m.userId}>
                      {m.name}
                    </option>
                  ))}
                </Select>
                <Field
                  label={t("agency.form.hours")}
                  value={row.hours}
                  inputMode="decimal"
                  onChange={(e) =>
                    setWork(
                      work.map((w) => (w.key === row.key ? { ...w, hours: e.target.value } : w)),
                    )
                  }
                  error={submitted || row.hours ? hourErrors[i] : undefined}
                  disabled={pending}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`${t("agency.form.remove")}: ${nameOf(row.userId)}`}
                  onClick={() => setWork(work.filter((w) => w.key !== row.key))}
                  disabled={pending}
                  className={cn(hourErrors[i] && (submitted || row.hours) ? "mb-7" : "")}
                >
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
          {show("work") ? <p className="text-urgent mt-2 text-sm">{errors.work}</p> : null}
          {freeMembers("").length > 0 ? (
            <Button
              type="button"
              variant="secondary"
              className="mt-4"
              disabled={pending}
              onClick={() => {
                // Первым предлагаем себя: чаще всего часы вписывает тот, кто работал.
                const free = freeMembers("");
                const pick = free.find((m) => m.userId === currentUserId) ?? free[0];
                setWork([...work, { key: nextKey, userId: pick.userId, hours: "" }]);
                setNextKey(nextKey + 1);
              }}
            >
              <Plus />
              {t("agency.form.addWorker")}
            </Button>
          ) : null}
        </Card>

        <Card>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field
              label={t("agency.form.month")}
              type="month"
              value={periodMonth}
              onChange={(e) => setPeriodMonth(e.target.value)}
              disabled={pending}
              required
              name="periodMonth"
            />
            <Select
              label={t("agency.form.status")}
              value={status}
              onChange={(e) => setStatus(e.target.value as OrderStatus)}
              disabled={pending}
              name="status"
            >
              {ORDER_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`agency.orderStatus.${s}` as MessageKey)}
                </option>
              ))}
            </Select>
            <Field
              label={t("agency.form.due")}
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              disabled={pending}
              name="dueDate"
            />
          </div>
          <label className="mt-4 grid gap-1.5 text-sm font-semibold">
            {t("agency.form.note")}
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              maxLength={4000}
              disabled={pending}
              className="border-line-strong bg-surface rounded-[10px] border p-3 text-sm font-normal"
            />
          </label>
        </Card>
      </div>

      <div className="grid gap-4 lg:sticky lg:top-6">
        <Card title={t("agency.form.preview")}>
          <div aria-live="polite" data-testid="split-preview">
            <p className="text-ink-soft text-sm">
              {t("agency.form.previewBase", { amount: formatMoney(preview.base) })}
            </p>
            <ul className="divide-line mt-3 divide-y text-sm">
              {preview.totals.people.map((p) => (
                <li key={p.userId} className="flex items-baseline justify-between gap-3 py-2">
                  <span className="min-w-0">
                    <span className="font-bold">{nameOf(p.userId)}</span>
                    <span className="text-ink-soft block text-[13px]">
                      {[
                        p.saleGrosze
                          ? `${t("agency.form.previewSale", { pct: sharePercent(shares.saleBp) })}: ${formatMoney(p.saleGrosze)}`
                          : null,
                        p.workGrosze
                          ? `${t("agency.form.previewWork", { pct: sharePercent(shares.workBp) })}: ${formatMoney(p.workGrosze)}`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                  <span className="font-display shrink-0 font-semibold tabular-nums">
                    {formatMoney(p.totalGrosze)}
                  </span>
                </li>
              ))}
              {preview.totals.unassignedGrosze > 0 ? (
                <li className="flex items-baseline justify-between gap-3 py-2">
                  <span className="text-hold font-bold">{t("agency.split.unassigned")}</span>
                  <span className="text-hold font-display shrink-0 font-semibold tabular-nums">
                    {formatMoney(preview.totals.unassignedGrosze)}
                  </span>
                </li>
              ) : null}
              <li className="flex items-baseline justify-between gap-3 py-2">
                <span className="text-ink-soft">
                  {t("agency.form.previewCompany", { pct: sharePercent(shares.companyBp) })}
                </span>
                <span className="font-display shrink-0 font-semibold tabular-nums">
                  {formatMoney(preview.totals.companyGrosze)}
                </span>
              </li>
            </ul>
            {mine ? (
              <p className="bg-surface-2 mt-3 rounded-[10px] px-3 py-2.5 text-sm font-bold">
                {t("agency.form.you", { amount: formatMoney(mine.totalGrosze) })}
              </p>
            ) : null}
          </div>
        </Card>
        <Button type="submit" size="lg" disabled={pending || clients.length === 0}>
          {t(pending ? "agency.form.saving" : "agency.form.save")}
        </Button>
        {clients.length === 0 ? (
          <p className="text-ink-soft text-sm">{t("agency.form.noClients")}</p>
        ) : null}
      </div>
    </form>
  );
}
