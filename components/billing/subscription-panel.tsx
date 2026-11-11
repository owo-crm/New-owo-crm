"use client";
import { Picker } from "@/components/ui/picker";

import { useState, useTransition } from "react";
import { Copy, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PriceTable } from "@/components/billing/price-table";
import {
  checkoutLinkAction,
  createClientCrmAction,
  saveSubscriptionAction,
} from "@/lib/billing/actions";
import { ADDON_KEYS, MODULES, type AddonKey } from "@/lib/billing/modules";
import { calculatePrice } from "@/lib/billing/pricing";
import { PRESETS, PRESET_KEYS } from "@/lib/presets";
import { t, type MessageKey } from "@/lib/i18n";

function ModuleChecks({
  value,
  onChange,
  disabled,
}: {
  value: AddonKey[];
  onChange: (v: AddonKey[]) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset className="grid gap-1.5" disabled={disabled}>
      <legend className="mb-1 text-sm font-semibold">{t("billing.agency.modules")}</legend>
      <label className="text-ink-soft flex min-h-9 items-center gap-2.5 text-sm">
        <input type="checkbox" checked disabled className="size-4" />
        {t(MODULES.leads.labelKey)}
      </label>
      {ADDON_KEYS.map((k) => (
        <label key={k} className="flex min-h-9 cursor-pointer items-center gap-2.5 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-[var(--ink)]"
            checked={value.includes(k)}
            onChange={(e) =>
              onChange(e.target.checked ? [...value, k] : value.filter((x) => x !== k))
            }
          />
          {t(MODULES[k].labelKey)}
        </label>
      ))}
    </fieldset>
  );
}

/** Нет CRM у клиента: мастер «Utwórz CRM klienta» — отрасль + модули одним нажатием. */
export function CreateCrmWizard({ clientId }: { clientId: string }) {
  const [preset, setPreset] = useState<string>(PRESET_KEYS[0]);
  const [modules, setModules] = useState<AddonKey[]>([]);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const price = calculatePrice({ modules: ["leads", ...modules], seats: 1 });
  return (
    <div className="grid gap-3" data-testid="crm-wizard">
      <p className="text-sm font-semibold">{t("billing.wizard.title")}</p>
      <label className="grid gap-1.5 text-sm font-semibold">
        {t("billing.wizard.preset")}
        <Picker
          value={preset}
          onChange={(e) => setPreset(e.target.value)}
          className="border-line-strong bg-surface h-10 rounded-lg border px-3 text-sm font-normal"
        >
          {PRESET_KEYS.filter((k) => k !== "agency").map((k) => (
            <option key={k} value={k}>
              {t(PRESETS[k].labelKey)}
            </option>
          ))}
        </Picker>
      </label>
      <ModuleChecks value={modules} onChange={setModules} disabled={pending} />
      <PriceTable price={price} />
      {error ? <p className="text-urgent text-sm">{error}</p> : null}
      <Button
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await createClientCrmAction(clientId, { preset, modules });
            if (r.error) setError(r.error);
          })
        }
      >
        {t("billing.wizard.create")}
      </Button>
    </div>
  );
}

export type SubscriptionInitial = {
  modules: AddonKey[];
  adClient: boolean;
  discountPct: number;
  email: string;
  seats: number;
  status: string;
  hasSubscription: boolean;
  stripeEnabled: boolean;
  lastError: string | null;
  requests: string[];
};

/**
 * Абонемент клиента в кабинете агентства: модули, скидки, живая цена (та же функция, что и
 * для Stripe), сохранение → Stripe пересчитывает подписку сам; ссылка на первую оплату.
 */
export function SubscriptionPanel({
  clientId,
  initial,
}: {
  clientId: string;
  initial: SubscriptionInitial;
}) {
  const [modules, setModules] = useState<AddonKey[]>(initial.modules);
  const [adClient, setAdClient] = useState(initial.adClient);
  const [discount, setDiscount] = useState(String(initial.discountPct));
  const [email, setEmail] = useState(initial.email);
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ text: string; error?: boolean }>();
  const [link, setLink] = useState<string>();
  const [copied, setCopied] = useState(false);

  const discountPct = Math.min(100, Math.max(0, Number(discount.replace(",", ".")) || 0));
  const price = calculatePrice({
    modules: ["leads", ...modules],
    seats: Math.max(1, initial.seats),
    adClient,
    discountBp: Math.round(discountPct * 100),
  });

  return (
    <div className="grid gap-4" data-testid="subscription-panel">
      <p className="text-ink-soft text-[13px]">
        {t("billing.settings.status")}:{" "}
        <b className="text-ink">{t(`billing.status.${initial.status}` as MessageKey)}</b> ·{" "}
        {t("billing.agency.seats", { count: Math.max(1, initial.seats) })}
      </p>
      {initial.requests.length > 0 ? (
        <p className="bg-surface-2 rounded-lg px-3 py-2 text-sm font-semibold">
          {t("billing.agency.requests", {
            modules: initial.requests
              .map((m) => t(MODULES[m as AddonKey]?.labelKey ?? "billing.modules.leads"))
              .join(", "),
          })}
        </p>
      ) : null}
      <ModuleChecks value={modules} onChange={setModules} disabled={pending} />
      <label className="flex min-h-9 cursor-pointer items-center gap-2.5 text-sm">
        <input
          type="checkbox"
          className="size-4 accent-[var(--ink)]"
          checked={adClient}
          onChange={(e) => setAdClient(e.target.checked)}
          disabled={pending}
        />
        {t("billing.agency.adClient")}
      </label>
      <div className="grid gap-3">
        <label className="grid gap-1.5 text-sm font-semibold">
          {t("billing.agency.discount")}
          <input
            value={discount}
            onChange={(e) => setDiscount(e.target.value)}
            inputMode="decimal"
            disabled={pending}
            className="border-line-strong bg-surface h-10 rounded-lg border px-3 text-sm font-normal"
          />
        </label>
        <label className="grid gap-1.5 text-sm font-semibold">
          {t("billing.agency.email")}
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={pending}
            className="border-line-strong bg-surface h-10 rounded-lg border px-3 text-sm font-normal"
          />
        </label>
      </div>
      <PriceTable price={price} />
      {initial.lastError ? (
        <p className="text-urgent text-[13px]">Stripe: {initial.lastError}</p>
      ) : null}
      {message ? (
        <p role="status" className={message.error ? "text-urgent text-sm" : "text-ok text-sm"}>
          {message.text}
        </p>
      ) : null}
      <Button
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await saveSubscriptionAction(clientId, {
              modules,
              adClient,
              discountPct,
              email,
            });
            setMessage(r.error ? { text: r.error, error: true } : { text: r.message ?? "" });
          })
        }
      >
        {t("billing.agency.save")}
      </Button>

      {initial.stripeEnabled && !initial.hasSubscription ? (
        <div className="border-line grid gap-2 border-t pt-4">
          <Button
            variant="secondary"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await checkoutLinkAction(clientId);
                if (r.url) setLink(r.url);
                else setMessage({ text: r.error ?? "", error: true });
              })
            }
          >
            <Link2 />
            {t("billing.agency.checkout")}
          </Button>
          <p className="text-ink-faint text-[12px]">{t("billing.agency.checkoutHint")}</p>
          {link ? (
            <div className="flex items-center gap-2">
              <input
                readOnly
                value={link}
                className="border-line-strong bg-surface-2 h-10 min-w-0 flex-1 rounded-lg border px-3 text-[13px]"
                onFocus={(e) => e.currentTarget.select()}
              />
              <Button
                variant="ghost"
                size="icon"
                aria-label={t("billing.agency.copy")}
                onClick={() => {
                  void navigator.clipboard?.writeText(link);
                  setCopied(true);
                }}
              >
                <Copy />
              </Button>
              {copied ? (
                <span className="text-ok text-[12px]">{t("billing.agency.copied")}</span>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : !initial.stripeEnabled ? (
        <p className="text-ink-faint text-[12px]">{t("billing.agency.stripeOff")}</p>
      ) : null}
    </div>
  );
}
