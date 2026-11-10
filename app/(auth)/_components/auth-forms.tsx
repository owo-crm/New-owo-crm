"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Checkbox, Field } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { SubmitButton } from "@/components/ui/submit-button";
import {
  requestPasswordReset,
  signIn,
  signUp,
  updatePassword,
  type FormState,
} from "@/lib/auth/actions";
import { t } from "@/lib/i18n";

const initial: FormState = {};

export function SignInForm({ next, canRegister }: { next?: string; canRegister: boolean }) {
  const [state, action] = useActionState(signIn, initial);
  return (
    <form action={action} className="grid gap-5" noValidate>
      {next ? <input type="hidden" name="next" value={next} /> : null}
      {state.message ? <Notice tone="error">{state.message}</Notice> : null}
      <Field
        label={t("common.email")}
        name="email"
        type="email"
        autoComplete="email"
        inputMode="email"
        defaultValue={state.email}
        error={state.errors?.email}
        required
      />
      <div className="grid gap-2">
        <Field
          label={t("common.password")}
          name="password"
          type="password"
          autoComplete="current-password"
          error={state.errors?.password}
          required
        />
        <Link
          href="/reset-hasla"
          className="text-ink-soft hover:text-ink justify-self-end text-sm font-semibold underline-offset-4 hover:underline"
        >
          {t("auth.login.forgot")}
        </Link>
      </div>
      <SubmitButton>{t("auth.login.submit")}</SubmitButton>
      {canRegister ? (
        <p className="text-ink-soft text-center text-sm">
          {t("auth.login.noAccount")}{" "}
          <Link href="/rejestracja" className="text-ink font-semibold underline underline-offset-4">
            {t("auth.login.toRegister")}
          </Link>
        </p>
      ) : null}
    </form>
  );
}

export function SignUpForm() {
  const [state, action] = useActionState(signUp, initial);
  if (state.ok) return <Notice tone="success">{state.message}</Notice>;
  return (
    <form action={action} className="grid gap-5" noValidate>
      {state.message ? <Notice tone="error">{state.message}</Notice> : null}
      <Field
        label={t("auth.register.fullName")}
        name="fullName"
        autoComplete="name"
        error={state.errors?.fullName}
        required
      />
      <Field
        label={t("common.email")}
        name="email"
        type="email"
        autoComplete="email"
        inputMode="email"
        defaultValue={state.email}
        error={state.errors?.email}
        required
      />
      <Field
        label={t("common.password")}
        name="password"
        type="password"
        autoComplete="new-password"
        hint={t("auth.register.passwordHint")}
        error={state.errors?.password}
        minLength={10}
        required
      />
      <Checkbox name="terms" label={t("auth.register.terms")} error={state.errors?.terms} />
      <SubmitButton>{t("auth.register.submit")}</SubmitButton>
      <p className="text-ink-soft text-center text-sm">
        {t("auth.register.hasAccount")}{" "}
        <Link href="/logowanie" className="text-ink font-semibold underline underline-offset-4">
          {t("auth.register.toLogin")}
        </Link>
      </p>
    </form>
  );
}

export function ResetForm() {
  const [state, action] = useActionState(requestPasswordReset, initial);
  if (state.ok) return <Notice tone="success">{state.message}</Notice>;
  return (
    <form action={action} className="grid gap-5" noValidate>
      <Field
        label={t("common.email")}
        name="email"
        type="email"
        autoComplete="email"
        inputMode="email"
        error={state.errors?.email}
        required
      />
      <SubmitButton>{t("auth.reset.submit")}</SubmitButton>
      <Link
        href="/logowanie"
        className="text-ink-soft hover:text-ink text-center text-sm font-semibold"
      >
        {t("common.back")}
      </Link>
    </form>
  );
}

export function NewPasswordForm({ token }: { token: string }) {
  const [state, action] = useActionState(updatePassword, initial);
  return (
    <form action={action} className="grid gap-5" noValidate>
      <input type="hidden" name="token" value={token} />
      {state.message ? (
        <Notice tone="error">
          {state.message}{" "}
          <Link href="/reset-hasla" className="font-semibold underline underline-offset-4">
            {t("auth.reset.submit")}
          </Link>
        </Notice>
      ) : null}
      <Field
        label={t("common.password")}
        name="password"
        type="password"
        autoComplete="new-password"
        hint={t("auth.register.passwordHint")}
        error={state.errors?.password}
        minLength={10}
        required
      />
      <SubmitButton>{t("auth.newPassword.submit")}</SubmitButton>
    </form>
  );
}
