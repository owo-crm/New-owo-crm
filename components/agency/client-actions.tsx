"use client";

import { useState, useTransition } from "react";
import { Bot, Check, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  linkClientOrgAction,
  openClientCrmAction,
  setOrderStatusAction,
  toggleSetupMarkAction,
} from "@/lib/agency/actions";
import type { OrderStatus } from "@/lib/agency/schemas";
import { plDateTime } from "@/lib/format";
import { t, type MessageKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/** Клиентские кнопки карточки клиента агентства. */

function useAction() {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const run = (fn: () => Promise<{ error?: string } | void>) =>
    start(async () => {
      setError(undefined);
      const r = await fn();
      if (r && r.error) setError(r.error);
    });
  return { pending, error, run };
}

export type ChecklistStep = { key: string; auto: boolean; doneAt: string | null };

/** Чек-лист настройки: автошаги только показываются, ручные — переключаются. */
export function SetupChecklist({ clientId, steps }: { clientId: string; steps: ChecklistStep[] }) {
  const { pending, error, run } = useAction();
  return (
    <>
      {error ? <p className="text-urgent mb-2 text-sm">{error}</p> : null}
      <ol className="grid gap-1" data-testid="setup-checklist">
        {steps.map((s, i) => {
          const done = Boolean(s.doneAt);
          const label = t(`agency.steps.${s.key}` as MessageKey);
          const box = (
            <span
              className={cn(
                "flex size-6 shrink-0 items-center justify-center rounded-md border-[1.5px]",
                done ? "bg-ok border-ok text-white" : "border-line-strong",
              )}
              aria-hidden
            >
              {done ? <Check className="size-4" /> : null}
            </span>
          );
          const body = (
            <span className="min-w-0 flex-1">
              <span className={cn("block", done ? "text-ink" : "text-ink-soft")}>
                <span className="text-ink-faint mr-1.5 tabular-nums">{i + 1}.</span>
                {label}
              </span>
              <span className="text-ink-faint flex items-center gap-1 text-[12px]">
                {s.auto ? (
                  <>
                    <Bot className="size-3.5" aria-hidden />
                    {t("agency.client.auto")}
                  </>
                ) : null}
                {done && s.doneAt ? (
                  <span>{(s.auto ? " · " : "") + plDateTime(s.doneAt)}</span>
                ) : null}
              </span>
            </span>
          );
          return (
            <li key={s.key}>
              {s.auto ? (
                <div className="flex min-h-11 items-center gap-3 px-1 py-1.5">
                  {box}
                  {body}
                </div>
              ) : (
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={done}
                  disabled={pending}
                  onClick={() => run(() => toggleSetupMarkAction(clientId, s.key, !done))}
                  className="hover:bg-surface-2 flex min-h-11 w-full items-center gap-3 rounded-lg px-1 py-1.5 text-left"
                >
                  {box}
                  {body}
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </>
  );
}

/** «Otwórz CRM klienta» / привязка к существующему бизнесу (создание — мастер в «Abonament CRM»). */
export function ClientCrmControls({
  clientId,
  clientOrgId,
  canOpen,
  linkable,
}: {
  clientId: string;
  clientOrgId: string | null;
  canOpen: boolean;
  linkable: { id: string; name: string }[];
}) {
  const { pending, error, run } = useAction();
  const [target, setTarget] = useState("");
  if (clientOrgId) {
    return canOpen ? (
      <Button
        variant="primary"
        disabled={pending}
        onClick={() => run(() => openClientCrmAction(clientOrgId))}
      >
        <ExternalLink />
        {t("agency.client.openCrm")}
      </Button>
    ) : null;
  }
  return (
    <div className="grid gap-3">
      {error ? <p className="text-urgent text-sm">{error}</p> : null}
      {linkable.length > 0 ? (
        <div className="flex flex-wrap items-end gap-2">
          <label className="grid min-w-0 flex-1 gap-1.5 text-sm font-semibold">
            {t("agency.client.linkCrm")}
            <select
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              className="border-line-strong bg-surface h-10 rounded-lg border px-3 text-sm font-normal"
            >
              <option value="">{t("agency.client.linkNone")}</option>
              {linkable.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
          <Button
            variant="secondary"
            disabled={pending || !target}
            onClick={() => run(() => linkClientOrgAction(clientId, target))}
          >
            {t("agency.client.link")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** Быстрые статусы заказа: Wystawiono → Opłacono, или Anuluj. */
export function OrderStatusButtons({ id, status }: { id: string; status: OrderStatus }) {
  const { pending, error, run } = useAction();
  const next: { to: OrderStatus; label: MessageKey }[] =
    status === "draft"
      ? [
          { to: "invoiced", label: "agency.client.markInvoiced" },
          { to: "cancelled", label: "agency.client.markCancelled" },
        ]
      : status === "invoiced"
        ? [{ to: "paid", label: "agency.client.markPaid" }]
        : [];
  if (next.length === 0) return null;
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {next.map((n) => (
        <Button
          key={n.to}
          size="sm"
          variant={n.to === "paid" ? "success" : n.to === "cancelled" ? "danger" : "soft"}
          disabled={pending}
          onClick={() => run(() => setOrderStatusAction(id, n.to))}
        >
          {t(n.label)}
        </Button>
      ))}
      {error ? <span className="text-urgent text-[12px]">{error}</span> : null}
    </span>
  );
}
