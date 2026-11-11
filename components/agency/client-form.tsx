"use client";
import { Picker } from "@/components/ui/picker";

import { useActionState } from "react";
import { Card } from "@/components/app-shell/page";
import { Field } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { saveClientAction, type ClientFormState } from "@/lib/agency/actions";
import { CLIENT_STATUSES, type ClientStatus } from "@/lib/agency/schemas";
import { t, type MessageKey } from "@/lib/i18n";

export type ClientFormValues = {
  id?: string;
  name: string;
  nip: string;
  contactName: string;
  phone: string;
  email: string;
  city: string;
  status: ClientStatus;
  startedAt: string;
  note: string;
};

/** Карточка клиента агентства: новая или правка. После сохранения — экран клиента. */
export function ClientForm({ initial }: { initial: ClientFormValues }) {
  const [state, action] = useActionState<ClientFormState, FormData>(saveClientAction, {});
  const err = (k: string) => state.fields?.[k];
  const text: { name: keyof ClientFormValues; label: MessageKey; type?: string; wide?: boolean }[] =
    [
      { name: "name", label: "agency.client.name", wide: true },
      { name: "nip", label: "agency.client.nip" },
      { name: "city", label: "agency.client.city" },
      { name: "contactName", label: "agency.client.contactName" },
      { name: "phone", label: "agency.client.phone", type: "tel" },
      { name: "email", label: "agency.client.email", type: "email" },
      { name: "startedAt", label: "agency.client.startedAt", type: "date" },
    ];
  return (
    <Card>
      <form action={action} noValidate className="grid gap-5">
        {initial.id ? <input type="hidden" name="id" value={initial.id} /> : null}
        {state.error ? (
          <p role="alert" className="text-urgent">
            {state.error}
          </p>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
          {text.map((f) => (
            <Field
              key={f.name}
              className={f.wide ? "sm:col-span-2" : undefined}
              name={f.name}
              label={t(f.label)}
              type={f.type ?? "text"}
              defaultValue={initial[f.name] ?? ""}
              error={err(f.name)}
              required={f.name === "name"}
            />
          ))}
          <label className="grid gap-1.5 text-sm font-semibold">
            {t("agency.client.status")}
            <Picker name="status" defaultValue={initial.status}>
              {CLIENT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`agency.status.${s}` as MessageKey)}
                </option>
              ))}
            </Picker>
          </label>
        </div>
        <label className="grid gap-1.5 text-sm font-semibold">
          {t("agency.client.note")}
          <textarea
            name="note"
            rows={3}
            maxLength={4000}
            defaultValue={initial.note}
            className="border-line-strong bg-surface rounded-lg border p-3 text-sm font-normal"
          />
        </label>
        <SubmitButton>{t("agency.client.save")}</SubmitButton>
      </form>
    </Card>
  );
}
