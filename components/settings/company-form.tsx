"use client";
import { useActionState } from "react";
import { Field } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { SubmitButton } from "@/components/ui/submit-button";
import { saveProfileAction, type ProfileState } from "@/lib/organizations/profile-actions";
import type { OrganizationProfile } from "@/lib/organizations/profile";
import { t } from "@/lib/i18n";

/** Данные фирмы: то, что попадает в умову, в счёт и в подпись письма. */
export function CompanyForm({
  initial,
  canEdit,
}: {
  initial: OrganizationProfile;
  canEdit: boolean;
}) {
  const [state, action] = useActionState<ProfileState, FormData>(saveProfileAction, {});
  const err = (k: string) =>
    k === "nip" && state.errors?.nip ? t("company.invalidNip") : undefined;
  return (
    <form action={action} className="grid gap-5">
      <Field
        name="name"
        label={t("company.name")}
        hint={t("company.nameHint")}
        defaultValue={initial.name}
        required
        maxLength={120}
        disabled={!canEdit}
        error={state.errors?.name ? t("common.required") : undefined}
      />
      <Field
        name="legal_name"
        label={t("company.legalName")}
        hint={t("company.legalNameHint")}
        defaultValue={initial.legal_name ?? ""}
        maxLength={200}
        disabled={!canEdit}
      />
      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          name="nip"
          label={t("company.nip")}
          hint={t("company.nipHint")}
          inputMode="numeric"
          defaultValue={initial.nip ?? ""}
          maxLength={10}
          disabled={!canEdit}
          error={err("nip")}
        />
        <Field
          name="bank_account"
          label={t("company.bank")}
          hint={t("company.bankHint")}
          defaultValue={initial.bank_account ?? ""}
          maxLength={60}
          disabled={!canEdit}
        />
      </div>
      <Field
        name="address"
        label={t("company.address")}
        defaultValue={initial.address ?? ""}
        maxLength={300}
        disabled={!canEdit}
      />
      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          name="phone"
          label={t("company.phone")}
          type="tel"
          defaultValue={initial.phone ?? ""}
          maxLength={40}
          disabled={!canEdit}
        />
        <Field
          name="email"
          label={t("company.email")}
          type="email"
          defaultValue={initial.email ?? ""}
          maxLength={160}
          disabled={!canEdit}
          error={state.errors?.email ? t("common.required") : undefined}
        />
      </div>
      <Field
        name="website"
        label={t("company.website")}
        defaultValue={initial.website ?? ""}
        maxLength={200}
        disabled={!canEdit}
      />
      <div className="grid gap-1.5">
        <label htmlFor="brand_color" className="text-ink-soft text-[13px] font-medium">
          {t("company.brandColor")}
        </label>
        <div className="flex items-center gap-3">
          <input
            id="brand_color"
            name="brand_color"
            type="color"
            defaultValue={initial.brand_color}
            disabled={!canEdit}
            className="border-line-strong bg-surface h-10 w-16 cursor-pointer rounded-lg border p-1"
          />
          <p className="text-ink-faint text-[13px]">{t("company.brandColorHint")}</p>
        </div>
      </div>
      {state.message ? <Notice tone="error">{state.message}</Notice> : null}
      {state.ok ? <Notice tone="success">{t("company.saved")}</Notice> : null}
      {canEdit ? (
        <div>
          <SubmitButton>{t("company.save")}</SubmitButton>
        </div>
      ) : null}
    </form>
  );
}
