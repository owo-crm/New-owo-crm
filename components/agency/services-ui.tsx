"use client";
import { Picker } from "@/components/ui/picker";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  addContributionAction,
  removeClientServiceAction,
  saveServiceAction,
  setClientServiceAction,
} from "@/lib/agency/actions";
import { moneyFieldValue, parseMoneyField } from "@/lib/agency/schemas";
import { formatMoney } from "@/lib/finance/money";
import { plDate, warsawToday } from "@/lib/format";
import { t, type MessageKey } from "@/lib/i18n";

/** Экраны услуг агентства (решение 027). Ответственный за услугу получает 65 % её заказов. */

type Member = { userId: string; name: string };
type Service = {
  id: string;
  name: string;
  owner_id: string;
  kind: "retainer" | "project";
  active: boolean;
  system_key: "crm" | "ads" | null;
};

const input =
  "border-line-strong bg-surface h-10 min-w-0 rounded-lg border px-3 text-[13.5px] lg:h-9";

function useRun() {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const run = (fn: () => Promise<{ error?: string }>, ok?: () => void) =>
    start(async () => {
      const r = await fn();
      setError(r.error);
      if (!r.error) ok?.();
    });
  return { pending, error, run };
}

function MemberSelect({
  members,
  value,
  onChange,
  label,
}: {
  members: Member[];
  value: string;
  onChange: (v: string) => void;
  label: string;
}) {
  return (
    <Picker
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={label}
      className={input}
    >
      {members.map((m) => (
        <option key={m.userId} value={m.userId}>
          {m.name}
        </option>
      ))}
    </Picker>
  );
}

/**
 * Строка услуги. Цены у услуги нет: она нужна, чтобы назначить ответственного (он получает
 * фонд исполнителей 65 % по её заказам) и разделить прибыль по направлениям.
 * У зашитых услуг (абонемент CRM, реклама) название не меняется — только ответственный.
 */
export function ServiceRow({ service, members }: { service: Service; members: Member[] }) {
  const system = service.system_key !== null;
  const [name, setName] = useState(service.name);
  const [owner, setOwner] = useState(service.owner_id);
  const [kind, setKind] = useState(service.kind);
  const [active, setActive] = useState(service.active);
  const { pending, error, run } = useRun();
  const dirty =
    name !== service.name ||
    owner !== service.owner_id ||
    kind !== service.kind ||
    active !== service.active;
  return (
    <li className="grid gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_11rem_9rem_auto] sm:items-center">
      <span className="grid gap-0.5">
        {system ? (
          <span className="truncate text-[13.5px] font-semibold">{service.name}</span>
        ) : (
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label={t("agency.services.name")}
            className={input}
          />
        )}
        {system ? (
          <span className="text-ink-faint text-[12px]">
            {t(`agency.services.system.${service.system_key}` as MessageKey)}
          </span>
        ) : null}
      </span>
      <MemberSelect
        members={members}
        value={owner}
        onChange={setOwner}
        label={t("agency.services.owner")}
      />
      {system ? (
        <span className="text-ink-soft text-[13px]">{t(`agency.kind.${service.kind}`)}</span>
      ) : (
        <Picker
          value={kind}
          onChange={(e) => setKind(e.target.value as typeof kind)}
          aria-label={t("agency.services.kind")}
          className={input}
        >
          <option value="retainer">{t("agency.kind.retainer")}</option>
          <option value="project">{t("agency.kind.project")}</option>
        </Picker>
      )}
      <span className="flex items-center gap-2">
        {system ? null : (
          <label className="text-ink-soft flex items-center gap-1.5 text-[12px]">
            <input
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
              className="size-4"
            />
            {t("agency.services.active")}
          </label>
        )}
        {dirty ? (
          <Button
            size="sm"
            disabled={pending}
            onClick={() =>
              run(() =>
                saveServiceAction({
                  id: service.id,
                  name: system ? service.name : name,
                  description: null,
                  ownerId: owner,
                  kind,
                  active,
                }),
              )
            }
          >
            {t("agency.services.save")}
          </Button>
        ) : null}
      </span>
      {error ? <span className="text-urgent text-[12px] sm:col-span-4">{error}</span> : null}
    </li>
  );
}

export function NewServiceForm({
  members,
  currentUserId,
}: {
  members: Member[];
  currentUserId: string;
}) {
  const [name, setName] = useState("");
  const [owner, setOwner] = useState(currentUserId);
  const [kind, setKind] = useState<"retainer" | "project">("project");
  const { pending, error, run } = useRun();
  return (
    <form
      className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_11rem_9rem_auto]"
      onSubmit={(e) => {
        e.preventDefault();
        run(
          () =>
            saveServiceAction({
              name,
              description: null,
              ownerId: owner,
              kind,
              active: true,
            }),
          () => setName(""),
        );
      }}
    >
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={t("agency.services.name")}
        aria-label={t("agency.services.name")}
        className={input}
        required
      />
      <MemberSelect
        members={members}
        value={owner}
        onChange={setOwner}
        label={t("agency.services.owner")}
      />
      <Picker
        value={kind}
        onChange={(e) => setKind(e.target.value as typeof kind)}
        aria-label={t("agency.services.kind")}
        className={input}
      >
        <option value="retainer">{t("agency.kind.retainer")}</option>
        <option value="project">{t("agency.kind.project")}</option>
      </Picker>
      <Button type="submit" variant="secondary" disabled={pending || !name.trim()}>
        <Plus />
        {t("agency.services.add")}
      </Button>
      {error ? <p className="text-urgent text-[12px] sm:col-span-4">{error}</p> : null}
    </form>
  );
}

// Абонемент CRM и реклама заводятся миграцией как зашитые услуги, здесь их нет.
const STARTER: { key: string; kind: "retainer" | "project" }[] = [
  { key: "social", kind: "retainer" },
  { key: "seo", kind: "retainer" },
  { key: "web", kind: "project" },
  { key: "automation", kind: "project" },
];

/** Каталог из документа услуг: 5 направлений + абонемент CRM; ответственного выбирают сами. */
export function StarterCatalog({
  members,
  currentUserId,
}: {
  members: Member[];
  currentUserId: string;
}) {
  const [rows, setRows] = useState(STARTER.map((s) => ({ ...s, on: true, owner: currentUserId })));
  const { pending, error, run } = useRun();
  return (
    <div className="grid gap-3" data-testid="starter-catalog">
      <p className="text-ink-soft text-[13px]">{t("agency.services.starterHint")}</p>
      <ul className="divide-line divide-y">
        {rows.map((r, i) => (
          <li key={r.key} className="flex flex-wrap items-center gap-3 py-2">
            <label className="flex min-w-0 flex-1 items-center gap-2.5 text-[13.5px]">
              <input
                type="checkbox"
                checked={r.on}
                onChange={(e) =>
                  setRows(rows.map((x, j) => (j === i ? { ...x, on: e.target.checked } : x)))
                }
                className="size-4"
              />
              {t(`agency.services.starterItems.${r.key}` as MessageKey)}
            </label>
            <MemberSelect
              members={members}
              value={r.owner}
              onChange={(v) => setRows(rows.map((x, j) => (j === i ? { ...x, owner: v } : x)))}
              label={t("agency.services.owner")}
            />
          </li>
        ))}
      </ul>
      {error ? <p className="text-urgent text-[12px]">{error}</p> : null}
      <Button
        disabled={pending || !rows.some((r) => r.on)}
        onClick={() =>
          run(async () => {
            for (const r of rows.filter((x) => x.on)) {
              const res = await saveServiceAction({
                name: t(`agency.services.starterItems.${r.key}` as MessageKey),
                description: null,
                ownerId: r.owner,
                kind: r.kind,
                active: true,
              });
              if (res.error) return res;
            }
            return {};
          })
        }
      >
        {t("agency.services.createStarter")}
      </Button>
    </div>
  );
}

/**
 * Услуги клиента: что ему оказываем. Цены здесь нет — она договорная и живёт в заказе.
 * У рекламы есть месячный бюджет: это деньги клиента, в раздел прибыли они не входят.
 */
export function ClientServicesPanel({
  clientId,
  items,
  services,
  members,
}: {
  clientId: string;
  items: {
    id: string;
    service_id: string;
    name: string;
    owner_id: string;
    system_key: "crm" | "ads" | null;
    monthly_budget_grosze: number | null;
    active: boolean;
  }[];
  services: Service[];
  members: Member[];
}) {
  const nameOf = (id: string) => members.find((m) => m.userId === id)?.name ?? "—";
  const free = services.filter((s) => s.active && !items.some((i) => i.service_id === s.id));
  const [pick, setPick] = useState(free[0]?.id ?? "");
  const [budgets, setBudgets] = useState<Record<string, string>>({});
  const { pending, error, run } = useRun();
  return (
    <div className="grid gap-3" data-testid="client-services">
      {items.length === 0 ? (
        <p className="text-ink-soft text-[13.5px]">{t("agency.services.clientEmpty")}</p>
      ) : (
        <ul className="divide-line divide-y">
          {items.map((i) => {
            const ads = i.system_key === "ads";
            const saved = moneyFieldValue(i.monthly_budget_grosze ?? 0);
            const value = budgets[i.id] ?? saved;
            const changed = ads && value !== saved;
            return (
              <li key={i.id} className="flex flex-wrap items-center gap-2 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-medium">{i.name}</span>
                  <span className="text-ink-faint text-[12px]">
                    65 % → {nameOf(i.owner_id)}
                    {ads && i.monthly_budget_grosze
                      ? ` · ${t("agency.services.budgetShort", {
                          sum: formatMoney(i.monthly_budget_grosze),
                        })}`
                      : ""}
                  </span>
                </span>
                {ads ? (
                  <input
                    value={value}
                    onChange={(e) => setBudgets({ ...budgets, [i.id]: e.target.value })}
                    inputMode="decimal"
                    placeholder="0"
                    aria-label={`${t("agency.services.budget")}: ${i.name}`}
                    className={`${input} w-28 text-right`}
                  />
                ) : null}
                {changed ? (
                  <Button
                    size="sm"
                    disabled={pending}
                    onClick={() =>
                      run(() =>
                        setClientServiceAction({
                          clientId,
                          serviceId: i.service_id,
                          monthlyBudgetGrosze: value ? parseMoneyField(value) : null,
                          active: i.active,
                        }),
                      )
                    }
                  >
                    {t("agency.services.save")}
                  </Button>
                ) : (
                  <Link
                    href={`/agencja/zlecenia/nowe?klient=${clientId}&usluga=${i.service_id}`}
                    className={buttonVariants({ variant: "secondary", size: "sm" })}
                  >
                    {t("agency.services.order")}
                  </Link>
                )}
                <Button
                  size="icon"
                  variant="ghost"
                  disabled={pending}
                  aria-label={`${t("agency.services.remove")}: ${i.name}`}
                  onClick={() => run(() => removeClientServiceAction(clientId, i.id))}
                >
                  <Trash2 />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      {free.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <Picker
            value={pick}
            onChange={(e) => setPick(e.target.value)}
            aria-label={t("agency.services.pick")}
            className={`${input} flex-1`}
          >
            {free.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Picker>
          <Button
            variant="secondary"
            disabled={pending || !pick}
            onClick={() =>
              run(() =>
                setClientServiceAction({
                  clientId,
                  serviceId: pick || free[0].id,
                  monthlyBudgetGrosze: null,
                  active: true,
                }),
              )
            }
          >
            <Plus />
            {t("agency.services.assign")}
          </Button>
        </div>
      ) : null}
      {error ? <p className="text-urgent text-[12px]">{error}</p> : null}
    </div>
  );
}

export function ContributionsPanel({
  items,
  members,
  currentUserId,
}: {
  items: {
    id: string;
    user_id: string;
    contributed_on: string;
    amount_grosze: number;
    note: string | null;
  }[];
  members: Member[];
  currentUserId: string;
}) {
  const nameOf = (id: string) => members.find((m) => m.userId === id)?.name ?? "—";
  const [user, setUser] = useState(currentUserId);
  const [date, setDate] = useState(warsawToday());
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const { pending, error, run } = useRun();
  return (
    <div className="grid gap-3">
      {items.length > 0 ? (
        <ul className="divide-line divide-y text-[13.5px]">
          {items.map((c) => (
            <li key={c.id} className="flex items-center gap-3 py-1.5">
              <span className="text-ink-faint w-20 shrink-0 tabular-nums">
                {plDate(c.contributed_on)}
              </span>
              <span className="min-w-0 flex-1 truncate">
                {nameOf(c.user_id)}
                {c.note ? <span className="text-ink-faint"> · {c.note}</span> : null}
              </span>
              <span className="tabular-nums">{formatMoney(c.amount_grosze)}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <form
        className="grid gap-2 sm:grid-cols-[10rem_8.5rem_7rem_minmax(0,1fr)_auto]"
        onSubmit={(e) => {
          e.preventDefault();
          run(
            () =>
              addContributionAction({
                userId: user,
                date,
                amountGrosze: parseMoneyField(amount),
                note: note.trim() || null,
              }),
            () => {
              setAmount("");
              setNote("");
            },
          );
        }}
      >
        <MemberSelect
          members={members}
          value={user}
          onChange={setUser}
          label={t("agency.services.contributor")}
        />
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          aria-label={t("agency.services.date")}
          className={input}
        />
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          inputMode="decimal"
          placeholder="0,00"
          aria-label={t("agency.form.costAmount")}
          className={`${input} text-right`}
        />
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t("agency.services.note")}
          aria-label={t("agency.services.note")}
          className={input}
        />
        <Button
          type="submit"
          variant="secondary"
          disabled={pending || !(parseMoneyField(amount) > 0)}
        >
          {t("agency.services.contribute")}
        </Button>
      </form>
      {error ? <p className="text-urgent text-[12px]">{error}</p> : null}
    </div>
  );
}
