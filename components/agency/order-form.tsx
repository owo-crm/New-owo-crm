"use client";
import { Picker } from "@/components/ui/picker";

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
  sellers: { userId: string; shareBp: number }[];
  workBasis: "hours" | "points";
  costs: { label: string; amountGrosze: number; paidTo: string | null }[];
  serviceId: string | null;
  periodMonth: string;
  status: OrderStatus;
  dueDate: string | null;
  note: string;
  work: { userId: string; hours: number; note: string }[];
};

type WorkRow = { key: number; userId: string; hours: string };
type SellerRow = { key: number; userId: string; percent: string };
type CostRow = { key: number; label: string; amount: string; paidTo: string };

function Select({
  label,
  hint,
  error,
  children,
  className,
  ...props
}: React.ComponentProps<typeof Picker> & { label: string; hint?: string; error?: string }) {
  return (
    <label className={cn("text-ink-soft grid gap-1.5 text-[13px] font-medium", className)}>
      {label}
      <Picker aria-invalid={error ? true : undefined} {...props}>
        {children}
      </Picker>
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
  services,
  clientServices,
}: {
  initial: OrderFormInitial;
  clients: Option[];
  members: Member[];
  shares: Shares;
  currentUserId: string;
  services: { id: string; name: string; owner_id: string; kind: OrderKind }[];
  clientServices: { client_id: string; service_id: string; price_grosze: number }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();
  const [submitted, setSubmitted] = useState(false);

  const [clientId, setClientId] = useState(initial.clientId);
  const [title, setTitle] = useState(initial.title);
  const [kind, setKind] = useState<OrderKind>(initial.kind);
  const [serviceId, setServiceId] = useState(initial.serviceId ?? "");
  const service = services.find((x) => x.id === serviceId);
  const [amount, setAmount] = useState(moneyFieldValue(initial.amountGrosze));
  // Прямые расходы строками; старый заказ с одной суммой → одна строка.
  const [costRows, setCostRows] = useState<CostRow[]>(() =>
    (initial.costs.length
      ? initial.costs
      : initial.directCostsGrosze
        ? [{ label: t("agency.form.costs"), amountGrosze: initial.directCostsGrosze, paidTo: null }]
        : []
    ).map((c, i) => ({
      key: i,
      label: c.label,
      amount: moneyFieldValue(c.amountGrosze),
      paidTo: c.paidTo ?? "",
    })),
  );
  const [sellers, setSellers] = useState<SellerRow[]>(() =>
    initial.sellers.map((x, i) => ({
      key: i,
      userId: x.userId,
      percent: String(x.shareBp / 100).replace(".", ","),
    })),
  );
  // Часы не считаем (решение 026): 65 % — по согласованным процентам.
  const workBasis = "points" as const;
  const [adBudget, setAdBudget] = useState(moneyFieldValue(initial.adBudgetGrosze));
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
  const [nextKey, setNextKey] = useState(100);

  const amountGrosze = parseMoneyField(amount);
  const costAmounts = costRows.map((c) => parseMoneyField(c.amount));
  const costsGrosze = costAmounts.some((a) => Number.isNaN(a))
    ? Number.NaN
    : costAmounts.reduce((sum, a) => sum + a, 0);
  const sellerBp = sellers.map((x) => {
    const v = Number(x.percent.replace(",", "."));
    return Number.isFinite(v) && v > 0 && v <= 100 ? Math.round(v * 100) : Number.NaN;
  });
  const sellerTotal = sellerBp.reduce((sum, v) => sum + (Number.isNaN(v) ? 0 : v), 0);
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
    sellers:
      sellerBp.some((v) => Number.isNaN(v)) || sellerTotal > 10000
        ? t("agency.form.errSellers")
        : new Set(sellers.map((x) => x.userId)).size !== sellers.length
          ? t("agency.form.errWorker")
          : undefined,
    costRows: costRows.some((c, i) => !c.label.trim() || !(costAmounts[i] > 0))
      ? t("agency.form.errCostRow")
      : undefined,
  };
  const hourErrors = hours.map((h) =>
    Number.isNaN(h) || h <= 0 || h > 100 ? t("agency.form.errShare") : undefined,
  );
  const valid =
    Object.values(errors).every((e) => !e) && (service ? true : hourErrors.every((e) => !e));
  const show = (key: string) => (submitted ? errors[key] : undefined);

  // Живой расчёт: неверные поля считаем нулём, чтобы превью не «прыгало» в ошибку.
  const preview = (() => {
    const a = Number.isNaN(amountGrosze) ? 0 : amountGrosze;
    const c = Number.isNaN(costsGrosze) ? 0 : Math.min(costsGrosze, a);
    const lines = splitOrder(
      {
        amountGrosze: a,
        directCostsGrosze: c,
        sellers: sellers
          .map((x, i) => ({ userId: x.userId, shareBp: sellerBp[i] }))
          .filter((x) => x.shareBp > 0),
        work: service
          ? [{ userId: service.owner_id, hours: 100 }]
          : work
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
        sellers: sellers.map((x, i) => ({ userId: x.userId, shareBp: sellerBp[i] })),
        workBasis,
        serviceId: serviceId || null,
        costs: costRows.map((c, i) => ({
          label: c.label.trim(),
          amountGrosze: costAmounts[i],
          paidTo: c.paidTo || null,
        })),
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
      className="grid grid-cols-1 items-start gap-5 pb-12 lg:grid-cols-[minmax(0,1fr)_22rem] lg:pb-0"
    >
      <div className="grid min-w-0 grid-cols-1 gap-5">
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
              className="sm:col-span-2"
              label={t("agency.form.service")}
              value={serviceId}
              onChange={(e) => {
                // Услуга подставляет тип, название и цену клиента; 65 % — её ответственному.
                const id = e.target.value;
                setServiceId(id);
                const sv = services.find((x) => x.id === id);
                if (!sv) return;
                setKind(sv.kind);
                if (!title.trim()) setTitle(sv.name);
                const cp = clientServices.find(
                  (c) => c.client_id === clientId && c.service_id === id,
                );
                if (cp) setAmount(moneyFieldValue(cp.price_grosze));
              }}
              disabled={pending}
              name="serviceId"
            >
              <option value="">{t("agency.form.serviceNone")}</option>
              {services.map((sv) => (
                <option key={sv.id} value={sv.id}>
                  {sv.name}
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
          </div>
        </Card>

        <Card title={t("agency.form.sellers")}>
          <p className="text-ink-soft -mt-1 mb-4 text-[13px]">{t("agency.form.sellersHint")}</p>
          <ul className="grid gap-3" aria-label={t("agency.form.sellers")}>
            {sellers.map((row) => (
              <li
                key={row.key}
                className="grid grid-cols-[minmax(0,1fr)_5.5rem_2.75rem] items-end gap-2"
              >
                <Select
                  label={t("agency.form.seller")}
                  value={row.userId}
                  onChange={(e) =>
                    setSellers(
                      sellers.map((x) =>
                        x.key === row.key ? { ...x, userId: e.target.value } : x,
                      ),
                    )
                  }
                  disabled={pending}
                >
                  {members.map((m) => (
                    <option key={m.userId} value={m.userId}>
                      {m.name}
                    </option>
                  ))}
                </Select>
                <Field
                  label={t("agency.form.sellerShare")}
                  value={row.percent}
                  inputMode="decimal"
                  onChange={(e) =>
                    setSellers(
                      sellers.map((x) =>
                        x.key === row.key ? { ...x, percent: e.target.value } : x,
                      ),
                    )
                  }
                  disabled={pending}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`${t("agency.form.remove")}: ${nameOf(row.userId)}`}
                  onClick={() => setSellers(sellers.filter((x) => x.key !== row.key))}
                  disabled={pending}
                >
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
          {errors.sellers && (submitted || sellers.length) ? (
            <p className="text-urgent mt-2 text-[13px]">{errors.sellers}</p>
          ) : sellers.length > 0 && sellerTotal < 10000 ? (
            <p className="text-hold mt-2 text-[13px]">{t("agency.form.sellersPartial")}</p>
          ) : null}
          <Button
            type="button"
            variant="secondary"
            className="mt-4"
            disabled={pending}
            onClick={() => {
              const free = members.filter((m) => !sellers.some((x) => x.userId === m.userId));
              const pick = free.find((m) => m.userId === currentUserId) ?? free[0];
              if (!pick) return;
              const rest = Math.max(0, 100 - sellerTotal / 100);
              setSellers([
                ...sellers,
                {
                  key: nextKey,
                  userId: pick.userId,
                  percent: String(rest || 100).replace(".", ","),
                },
              ]);
              setNextKey(nextKey + 1);
            }}
          >
            <Plus />
            {t("agency.form.addSeller")}
          </Button>
        </Card>

        <Card title={t("agency.form.costs")}>
          <p className="text-ink-soft -mt-1 mb-4 text-[13px]">{t("agency.form.costsHint")}</p>
          <ul className="grid gap-3" aria-label={t("agency.form.costs")}>
            {costRows.map((row) => (
              <li
                key={row.key}
                className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_7rem_minmax(0,10rem)_2.75rem] sm:items-end"
              >
                <Field
                  label={t("agency.form.costLabel")}
                  value={row.label}
                  onChange={(e) =>
                    setCostRows(
                      costRows.map((c) =>
                        c.key === row.key ? { ...c, label: e.target.value } : c,
                      ),
                    )
                  }
                  maxLength={200}
                  disabled={pending}
                />
                <Field
                  label={t("agency.form.costAmount")}
                  value={row.amount}
                  inputMode="decimal"
                  onChange={(e) =>
                    setCostRows(
                      costRows.map((c) =>
                        c.key === row.key ? { ...c, amount: e.target.value } : c,
                      ),
                    )
                  }
                  disabled={pending}
                />
                <Select
                  label={t("agency.form.costPaidTo")}
                  value={row.paidTo}
                  onChange={(e) =>
                    setCostRows(
                      costRows.map((c) =>
                        c.key === row.key ? { ...c, paidTo: e.target.value } : c,
                      ),
                    )
                  }
                  disabled={pending}
                >
                  <option value="">{t("agency.form.costExternal")}</option>
                  {members.map((m) => (
                    <option key={m.userId} value={m.userId}>
                      {m.name}
                    </option>
                  ))}
                </Select>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`${t("agency.form.remove")}: ${row.label}`}
                  onClick={() => setCostRows(costRows.filter((c) => c.key !== row.key))}
                  disabled={pending}
                >
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
          {(errors.costRows || errors.costs) && submitted ? (
            <p className="text-urgent mt-2 text-[13px]">{errors.costRows ?? errors.costs}</p>
          ) : null}
          <Button
            type="button"
            variant="secondary"
            className="mt-4"
            disabled={pending}
            onClick={() => {
              setCostRows([...costRows, { key: nextKey, label: "", amount: "", paidTo: "" }]);
              setNextKey(nextKey + 1);
            }}
          >
            <Plus />
            {t("agency.form.addCost")}
          </Button>
        </Card>

        {service ? (
          <Card title={t("agency.form.work")}>
            <p className="text-[13.5px]">
              {t("agency.form.serviceOwner", { name: nameOf(service.owner_id) })}
            </p>
          </Card>
        ) : (
          <Card title={t("agency.form.work")}>
            <div className="-mt-1 mb-4 flex flex-wrap items-center justify-between gap-3">
              <p className="text-ink-soft text-[13px]">{t("agency.form.workHint")}</p>
            </div>
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
                    label={t("agency.form.sellerShare")}
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
            {work.length > 0 &&
            Math.abs(hours.reduce((sum, h) => sum + (h > 0 ? h : 0), 0) - 100) > 0.001 ? (
              <p className="text-hold mt-2 text-[13px]">{t("agency.form.workNot100")}</p>
            ) : null}
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
                  // Новому исполнителю — оставшийся до 100 % процент.
                  const used = hours.reduce((sum, h) => sum + (h > 0 ? h : 0), 0);
                  const rest = Math.max(0, Math.round((100 - used) * 100) / 100);
                  setWork([
                    ...work,
                    {
                      key: nextKey,
                      userId: pick.userId,
                      hours: rest ? String(rest).replace(".", ",") : "",
                    },
                  ]);
                  setNextKey(nextKey + 1);
                }}
              >
                <Plus />
                {t("agency.form.addWorker")}
              </Button>
            ) : null}
          </Card>
        )}

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
              className="border-line-strong bg-surface rounded-lg border p-3 text-sm font-normal"
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
                    <span className="font-semibold">{nameOf(p.userId)}</span>
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
                  <span className="shrink-0 font-semibold tabular-nums">
                    {formatMoney(p.totalGrosze)}
                  </span>
                </li>
              ))}
              {preview.totals.unassignedGrosze > 0 ? (
                <li className="flex items-baseline justify-between gap-3 py-2">
                  <span className="text-hold font-semibold">{t("agency.split.unassigned")}</span>
                  <span className="text-hold shrink-0 font-semibold tabular-nums">
                    {formatMoney(preview.totals.unassignedGrosze)}
                  </span>
                </li>
              ) : null}
              <li className="flex items-baseline justify-between gap-3 py-2">
                <span className="text-ink-soft">
                  {t("agency.form.previewCompany", { pct: sharePercent(shares.companyBp) })}
                </span>
                <span className="shrink-0 font-semibold tabular-nums">
                  {formatMoney(preview.totals.companyGrosze)}
                </span>
              </li>
            </ul>
            {mine ? (
              <p className="bg-surface-2 mt-3 rounded-lg px-3 py-2.5 text-sm font-semibold">
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

      {/* Телефон: полный блок «Podział» внизу формы, поэтому доля видна всегда — полоской над меню. */}
      <div
        aria-hidden
        className="border-line bg-surface fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-20 flex items-center justify-between gap-3 border-t px-4 py-2.5 text-sm lg:hidden"
      >
        <span className="text-ink-soft truncate">
          {t("agency.form.previewBase", { amount: formatMoney(preview.base) })}
        </span>
        <span className="shrink-0 font-semibold tabular-nums">
          {mine
            ? t("agency.form.you", { amount: formatMoney(mine.totalGrosze) })
            : preview.totals.unassignedGrosze > 0
              ? `${t("agency.split.unassigned")}: ${formatMoney(preview.totals.unassignedGrosze)}`
              : null}
        </span>
      </div>
    </form>
  );
}
