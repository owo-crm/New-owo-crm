"use client";
import Link from "next/link";
import { useActionState } from "react";
import { Card } from "@/components/app-shell/page";
import { Field } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { SubmitButton } from "@/components/ui/submit-button";
import {
  createContractAction,
  createGuestMenuAction,
  createOfferAction,
  type DocumentFormState,
} from "@/lib/documents/actions";
import { t, type MessageKey } from "@/lib/i18n";

const area =
  "border-line-strong bg-surface-2 w-full rounded-lg border p-3 font-[inherit] text-[15px] leading-relaxed";

function Area({
  name,
  label,
  value,
  rows = 4,
}: {
  name: string;
  label: string;
  value: string;
  rows?: number;
}) {
  return (
    <label className="grid gap-2 text-sm font-semibold">
      {label}
      <textarea name={name} defaultValue={value} rows={rows} className={area} />
    </label>
  );
}

export function OfferForm({
  leadId,
  pkg,
  values,
}: {
  leadId: string;
  pkg: string;
  values: Record<string, string>;
}) {
  const [state, action] = useActionState<DocumentFormState, FormData>(createOfferAction, {});
  const v = state.values ?? values;
  const f = (key: string) => t(`docs.f_${key}` as MessageKey);
  return (
    <form action={action} className="grid gap-5">
      <input type="hidden" name="leadId" value={leadId} />
      <input type="hidden" name="pkg" value={pkg} />
      {state.error ? <Notice tone="error">{state.error}</Notice> : null}
      <Card>
        <div className="grid gap-4 sm:grid-cols-2">
          {(["date", "guests", "venue", "hours", "price", "listPrice"] as const).map((key) => (
            <Field key={key} name={key} label={f(key)} defaultValue={v[key]} />
          ))}
        </div>
        <div className="mt-4">
          <Area name="message" label={f("message")} value={v.message} rows={3} />
        </div>
      </Card>
      <Card title={t("docs.scopeTitle")}>
        <p className="text-ink-soft -mt-1 mb-4 text-sm">{t("docs.scopeIntro")}</p>
        <div className="grid gap-4">
          {(["service", "alcohol", "softs", "ice", "additions"] as const).map((key) => (
            <Area key={key} name={key} label={f(key)} value={v[key]} />
          ))}
          <Area name="menu" label={f("menu")} value={v.menu} rows={14} />
        </div>
      </Card>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton>{t("docs.generate")}</SubmitButton>
        <Link href={`/leady/${leadId}`} className="text-ink-soft text-sm font-semibold">
          {t("docs.back")}
        </Link>
      </div>
    </form>
  );
}

export function GuestMenuForm({ leadId, menu }: { leadId: string; menu: string }) {
  const [state, action] = useActionState<DocumentFormState, FormData>(createGuestMenuAction, {});
  return (
    <form action={action} className="grid gap-5">
      <input type="hidden" name="leadId" value={leadId} />
      {state.error ? <Notice tone="error">{state.error}</Notice> : null}
      <Card>
        <Area name="menu" label={t("docs.f_menu")} value={state.values?.menu ?? menu} rows={18} />
      </Card>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton>{t("docs.generate")}</SubmitButton>
        <Link href={`/leady/${leadId}`} className="text-ink-soft text-sm font-semibold">
          {t("docs.back")}
        </Link>
      </div>
    </form>
  );
}

export function ContractForm({
  leadId,
  values,
}: {
  leadId: string;
  values: Record<string, string>;
}) {
  const [state, action] = useActionState<DocumentFormState, FormData>(createContractAction, {});
  const v = state.values ?? values;
  const pkg = (v.pkg || "").toLowerCase();
  return (
    <form action={action} className="grid gap-5">
      <input type="hidden" name="leadId" value={leadId} />
      {state.error ? <Notice tone="error">{state.error}</Notice> : null}
      <Card>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="grid gap-2 text-sm font-semibold">
            {t("leads.fields.package_name")}
            <select
              name="pkg"
              defaultValue={["simple", "standard", "premium"].includes(pkg) ? pkg : "standard"}
              className="border-line-strong bg-surface-2 h-11 rounded-lg border px-3"
            >
              <option value="simple">Simple</option>
              <option value="standard">Standard</option>
              <option value="premium">Premium</option>
            </select>
          </label>
          <Field
            name="price"
            label={t("docs.c_price")}
            defaultValue={v.price}
            hint={t("docs.c_priceHint")}
          />
          <Field name="date" label={t("docs.f_date")} defaultValue={v.date} />
          <Field name="city" label={t("docs.c_city")} defaultValue={v.city} />
          <Field name="guests" label={t("docs.c_guests")} defaultValue={v.guests} />
          <Field name="hours" label={t("docs.f_hours")} defaultValue={v.hours} />
        </div>
        <div className="mt-4 grid gap-4">
          <Field name="clientName" label={t("docs.c_client")} defaultValue={v.clientName} />
          <Area name="address" label={t("docs.c_address")} value={v.address} rows={2} />
        </div>
      </Card>
      <p className="text-ink-soft text-sm">{t("docs.c_note")}</p>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton>{t("docs.generate")}</SubmitButton>
        <Link href={`/leady/${leadId}`} className="text-ink-soft text-sm font-semibold">
          {t("docs.back")}
        </Link>
      </div>
    </form>
  );
}
