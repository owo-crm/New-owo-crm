"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Field } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/app-shell/page";
import { createManualLead } from "@/lib/leads/actions";
import { t, type MessageKey } from "@/lib/i18n";
const fields: { name: string; label: MessageKey; type?: string }[] = [
  { name: "name", label: "leads.fields.client_name" },
  { name: "phone", label: "leads.fields.phone_e164", type: "tel" },
  { name: "email", label: "leads.fields.email", type: "email" },
  { name: "event_type", label: "leads.fields.event_type" },
  { name: "event_date", label: "leads.fields.event_date", type: "date" },
  { name: "city", label: "leads.fields.event_city" },
  { name: "venue", label: "leads.fields.venue" },
  { name: "guests", label: "leads.fields.guests", type: "number" },
  { name: "budget", label: "leads.fields.budget_grosze" },
];
export function NewLeadForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();
  const [errors, setErrors] = useState<Record<string, string>>({});
  return (
    <Card>
      <form
        noValidate
        className="grid gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          const data = new FormData(e.currentTarget);
          startTransition(async () => {
            setError(undefined);
            const result = await createManualLead(data);
            if (result.id) {
              router.push(`/leady/${result.id}`);
              router.refresh();
            } else {
              setError(result.error);
              setErrors(result.fields ?? {});
            }
          });
        }}
      >
        <p className="text-ink-soft text-sm">{t("leads.contactHint")}</p>
        {error ? (
          <p role="alert" className="text-urgent">
            {error}
          </p>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
          {fields.map((field) => (
            <Field
              key={field.name}
              name={field.name}
              label={t(field.label)}
              type={field.type ?? "text"}
              error={errors[field.name]}
              disabled={pending}
              min={field.type === "number" ? 0 : undefined}
              inputMode={field.name === "budget" ? "decimal" : undefined}
            />
          ))}
        </div>
        <label className="grid gap-2 text-sm font-bold">
          {t("leads.fields.message")}
          <textarea
            name="message"
            rows={4}
            maxLength={10000}
            disabled={pending}
            className="border-line-strong bg-surface-2 rounded-[10px] border p-3 text-base font-normal"
          />
        </label>
        <Button disabled={pending} type="submit">
          {t(pending ? "leads.saving" : "leads.addLead")}
        </Button>
      </form>
    </Card>
  );
}
