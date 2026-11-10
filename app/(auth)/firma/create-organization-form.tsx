"use client";

import { useActionState } from "react";
import { Field, Select } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { SubmitButton } from "@/components/ui/submit-button";
import { createOrganization, type CreateOrgState } from "@/lib/organizations/actions";
import { PRESETS, PRESET_KEYS } from "@/lib/presets";
import { t } from "@/lib/i18n";

const initial: CreateOrgState = {};

export function CreateOrganizationForm() {
  const [state, action] = useActionState(createOrganization, initial);
  return (
    <form action={action} className="grid gap-5" noValidate>
      {state.message ? <Notice tone="error">{state.message}</Notice> : null}
      <Field
        label={t("onboarding.company.name")}
        name="name"
        placeholder={t("onboarding.company.namePlaceholder")}
        autoComplete="organization"
        defaultValue={state.name}
        error={state.errors?.name}
        required
      />
      <Select label={t("onboarding.company.preset")} name="preset" defaultValue="event-services">
        {PRESET_KEYS.map((key) => (
          <option key={key} value={key}>
            {t(PRESETS[key].labelKey)}
          </option>
        ))}
      </Select>
      <SubmitButton>{t("onboarding.company.submit")}</SubmitButton>
    </form>
  );
}
