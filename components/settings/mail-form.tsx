"use client";
import { useActionState, useState } from "react";
import { Field, Select } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { SubmitButton } from "@/components/ui/submit-button";
import { saveMailSettings, sendTestMail, type MailFormState } from "@/lib/mail/actions";
import { t } from "@/lib/i18n";

export type MailSettingsView = {
  transport: "none" | "smtp" | "resend";
  fromName: string;
  fromEmail: string;
  replyTo: string;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  dailyLimit: number;
  secretSet: boolean;
  lastTestAt: string | null;
  lastTestOk: boolean | null;
  lastTestError: string | null;
  sentToday: number;
};

function Result({ state }: { state: MailFormState }) {
  if (state.error)
    return (
      <Notice tone="error">
        {state.error}
        {state.detail ? (
          <span className="mt-1 block font-mono text-[12px] break-all opacity-80">
            {state.detail}
          </span>
        ) : null}
      </Notice>
    );
  if (state.ok) return <Notice tone="success">{state.ok}</Notice>;
  return null;
}

/** Настройки почты фирмы: способ отправки, отправитель, пароль (только ввод), тестовое письмо. */
export function MailSettingsForm({
  initial,
  canEdit,
  keyConfigured,
}: {
  initial: MailSettingsView;
  canEdit: boolean;
  keyConfigured: boolean;
}) {
  const [transport, setTransport] = useState(initial.transport);
  const [saveState, save] = useActionState<MailFormState, FormData>(saveMailSettings, {});
  const [testState, test] = useActionState<MailFormState>(sendTestMail, {});
  const disabled = !canEdit;
  const secretHint = initial.secretSet ? t("mail.secretSetHint") : undefined;

  return (
    <div className="grid gap-6">
      {!keyConfigured ? <Notice tone="error">{t("mail.errors.secret_key_missing")}</Notice> : null}
      {!canEdit ? <p className="text-ink-soft text-sm">{t("mail.readOnly")}</p> : null}

      <form action={save} className="grid gap-4">
        <Result state={saveState} />
        <Select
          name="transport"
          label={t("mail.transport")}
          value={transport}
          onChange={(e) => setTransport(e.target.value as MailSettingsView["transport"])}
          disabled={disabled}
        >
          <option value="none">{t("mail.transportNone")}</option>
          <option value="smtp">{t("mail.transportSmtp")}</option>
          <option value="resend">{t("mail.transportResend")}</option>
        </Select>

        {transport === "none" ? (
          <p className="text-ink-soft text-sm">{t("mail.noneHint")}</p>
        ) : (
          <>
            <Field
              name="fromName"
              label={t("mail.fromName")}
              hint={t("mail.fromNameHint")}
              defaultValue={initial.fromName}
              disabled={disabled}
            />
            {transport === "smtp" ? (
              <>
                <Field
                  name="smtpUser"
                  type="email"
                  label={t("mail.smtpUser")}
                  hint={t("mail.smtpUserHint")}
                  defaultValue={initial.smtpUser}
                  autoComplete="off"
                  required
                  disabled={disabled}
                />
                <Field
                  name="secret"
                  type="password"
                  label={t("mail.smtpPassword")}
                  hint={secretHint ?? t("mail.smtpPasswordHint")}
                  placeholder={initial.secretSet ? "••••••••••••••••" : ""}
                  autoComplete="new-password"
                  disabled={disabled}
                />
                <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
                  <Field
                    name="smtpHost"
                    label={t("mail.smtpHost")}
                    defaultValue={initial.smtpHost}
                    required
                    disabled={disabled}
                  />
                  <Field
                    name="smtpPort"
                    type="number"
                    label={t("mail.smtpPort")}
                    defaultValue={initial.smtpPort}
                    required
                    disabled={disabled}
                  />
                </div>
              </>
            ) : (
              <>
                <Field
                  name="fromEmail"
                  type="email"
                  label={t("mail.fromEmail")}
                  hint={t("mail.fromEmailHint")}
                  defaultValue={initial.fromEmail}
                  required
                  disabled={disabled}
                />
                <Field
                  name="secret"
                  type="password"
                  label={t("mail.resendKey")}
                  hint={secretHint}
                  placeholder={initial.secretSet ? "••••••••••••••••" : "re_…"}
                  autoComplete="new-password"
                  disabled={disabled}
                />
              </>
            )}
            <Field
              name="replyTo"
              type="email"
              label={t("mail.replyTo")}
              hint={t("mail.replyToHint")}
              defaultValue={initial.replyTo}
              disabled={disabled}
            />
            <Field
              name="dailyLimit"
              type="number"
              min={1}
              max={2000}
              label={t("mail.dailyLimit")}
              hint={t("mail.dailyLimitHint", { sent: initial.sentToday })}
              defaultValue={initial.dailyLimit}
              disabled={disabled}
            />
          </>
        )}
        {canEdit ? (
          <div>
            <SubmitButton>{t("mail.save")}</SubmitButton>
          </div>
        ) : null}
      </form>

      {initial.transport !== "none" && canEdit ? (
        <form action={test} className="border-line grid gap-3 border-t pt-5">
          <h2 className="text-[15px] font-semibold">{t("mail.testTitle")}</h2>
          <p className="text-ink-soft text-sm" hidden={Boolean(testState.error || testState.ok)}>
            {initial.lastTestAt
              ? initial.lastTestOk
                ? t("mail.lastTestOk")
                : t("mail.lastTestFailed", { error: initial.lastTestError ?? "" })
              : t("mail.testHint")}
          </p>
          <Result state={testState} />
          <div>
            <SubmitButton variant="secondary">{t("mail.testSend")}</SubmitButton>
          </div>
        </form>
      ) : null}
    </div>
  );
}
