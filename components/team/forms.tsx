"use client";
import { Picker } from "@/components/ui/picker";
import Link from "next/link";
import { useActionState, useState, useTransition } from "react";
import { Field } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/submit-button";
import {
  createInviteAction,
  joinAction,
  registerWithInviteAction,
  removeMemberAction,
  revokeInviteAction,
  setMemberRoleAction,
  type InviteState,
  type JoinState,
} from "@/lib/team/actions";
import { PRESETS, PRESET_KEYS } from "@/lib/presets";
import { createBusinessAction, type BusinessState } from "@/lib/team/business-actions";
import { importLeadsAction, type ImportState } from "@/lib/leads/import-actions";
import { t, type MessageKey } from "@/lib/i18n";

const select = "border-line-strong bg-surface h-10 rounded-lg border px-3 text-sm";

export function InviteForm({ canInviteOwner }: { canInviteOwner: boolean }) {
  const [state, action] = useActionState<InviteState, FormData>(createInviteAction, {});
  const [copied, setCopied] = useState(false);
  return (
    <form action={action} className="grid gap-4">
      {state.error ? <Notice tone="error">{state.error}</Notice> : null}
      <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
        <Field name="note" label={t("team.note")} placeholder={t("team.notePlaceholder")} />
        <label className="grid gap-2 text-sm font-semibold">
          {t("team.role")}
          <Picker name="role" defaultValue="member" className={select}>
            <option value="member">{t("team.role_member")}</option>
            <option value="admin">{t("team.role_admin")}</option>
            {canInviteOwner ? <option value="owner">{t("team.role_owner")}</option> : null}
          </Picker>
        </label>
      </div>
      <p className="text-ink-soft text-sm">{t("team.roleHint")}</p>
      <div>
        <SubmitButton>{t("team.create")}</SubmitButton>
      </div>
      {state.url ? (
        <div className="border-ok/40 rounded-xl border p-3">
          <p className="text-ok text-sm font-semibold">{t("team.linkReady")}</p>
          <div className="mt-2 flex gap-2">
            <code
              className="bg-surface-2 min-w-0 flex-1 rounded-lg p-2.5 text-sm break-all select-all"
              data-testid="invite-url"
            >
              {state.url}
            </code>
            <Button
              type="button"
              variant="secondary"
              onClick={() => navigator.clipboard?.writeText(state.url!).then(() => setCopied(true))}
            >
              {copied ? t("team.copied") : t("team.copy")}
            </Button>
          </div>
        </div>
      ) : null}
    </form>
  );
}

export function MemberControls({
  userId,
  role,
  canChangeRole,
  canRemove,
}: {
  userId: string;
  role: string;
  canChangeRole: boolean;
  canRemove: boolean;
}) {
  const [pending, start] = useTransition();
  return (
    <div className="flex items-center gap-2">
      {canChangeRole ? (
        <Picker
          aria-label={t("team.role")}
          className={select}
          defaultValue={role}
          disabled={pending}
          onChange={(e) => start(() => setMemberRoleAction(userId, e.target.value))}
        >
          {(["owner", "admin", "member"] as const).map((r) => (
            <option key={r} value={r}>
              {t(`team.role_${r}` as MessageKey)}
            </option>
          ))}
        </Picker>
      ) : (
        <span className="badge">{t(`team.role_${role}` as MessageKey)}</span>
      )}
      {canRemove ? (
        <Button
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() => {
            if (window.confirm(t("team.remove") + "?")) start(() => removeMemberAction(userId));
          }}
        >
          {t("team.remove")}
        </Button>
      ) : null}
    </div>
  );
}

export function RevokeButton({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() => start(() => revokeInviteAction(id))}
    >
      {t("team.revoke")}
    </Button>
  );
}

export function JoinForm({ token }: { token: string }) {
  const [state, action] = useActionState<JoinState, FormData>(joinAction, {});
  return (
    <form action={action} className="grid gap-4">
      <input type="hidden" name="token" value={token} />
      {state.error ? <Notice tone="error">{state.error}</Notice> : null}
      <SubmitButton>{t("team.join")}</SubmitButton>
    </form>
  );
}

export function RegisterInviteForm({ token }: { token: string }) {
  const [state, action] = useActionState<JoinState, FormData>(registerWithInviteAction, {});
  return (
    <form action={action} className="grid gap-5" noValidate>
      <input type="hidden" name="token" value={token} />
      {state.error ? <Notice tone="error">{state.error}</Notice> : null}
      <Field
        name="name"
        label={t("team.yourName")}
        autoComplete="name"
        defaultValue={state.name}
        required
      />
      <Field
        name="login"
        label={t("auth.register.login")}
        hint={t("auth.register.loginHint")}
        autoComplete="username"
        autoCapitalize="none"
        defaultValue={state.login}
        required
      />
      <Field
        name="password"
        type="password"
        label={t("common.password")}
        hint={t("auth.register.passwordHint")}
        autoComplete="new-password"
        required
      />
      <SubmitButton>{t("team.createAccount")}</SubmitButton>
      <Link
        href={`/logowanie?next=/zaproszenie/${token}`}
        className="text-ink-soft text-center text-sm font-semibold underline underline-offset-4"
      >
        {t("team.haveAccount")}
      </Link>
    </form>
  );
}

export function BusinessForm() {
  const [state, action] = useActionState<BusinessState, FormData>(createBusinessAction, {});
  return (
    <form action={action} className="grid gap-4">
      {state.error ? <Notice tone="error">{state.error}</Notice> : null}
      <Field
        name="name"
        label="Nazwa biznesu"
        placeholder="np. OWO Ads"
        defaultValue={state.name}
        required
      />
      <label className="grid gap-2 text-sm font-semibold">
        {t("presets.label")}
        <Picker name="preset" defaultValue="event-services">
          {PRESET_KEYS.map((key) => (
            <option key={key} value={key}>
              {t(PRESETS[key].labelKey)}
            </option>
          ))}
        </Picker>
      </label>
      <label className="grid gap-2 text-sm font-semibold">
        Kolor biznesu
        <input
          type="color"
          name="color"
          defaultValue="#2563eb"
          className="border-line-strong h-10 w-20 rounded-lg border"
        />
      </label>
      <div>
        <SubmitButton>Utwórz biznes</SubmitButton>
      </div>
    </form>
  );
}

const CODES: Record<string, string> = {
  no_contact: "brak telefonu i e-maila",
  duplicate_uid: "powtórzony identyfikator",
  invalid_created_at: "nieczytelna data dodania",
  database_error: "błąd zapisu",
  unknown_stage: "nieznany etap",
  invalid_row: "nieprawidłowe dane",
};

export function ImportForm() {
  const [state, action] = useActionState<ImportState, FormData>(importLeadsAction, {});
  const r = state.report;
  return (
    <form action={action} className="grid gap-4">
      {state.error ? <Notice tone="error">{state.error}</Notice> : null}
      <label className="grid gap-2 text-sm font-semibold">
        Plik CSV
        <input
          type="file"
          name="file"
          accept=".csv,text/csv"
          required
          className="border-line-strong bg-surface rounded-lg border p-2 text-sm"
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <SubmitButton variant="secondary">Sprawdź plik</SubmitButton>
        <SubmitButton name="apply" value="1">
          Importuj leady
        </SubmitButton>
      </div>
      {r ? (
        <div className="border-line rounded-xl border p-4 text-sm" role="status">
          <p className="font-semibold">
            {r.inserted === undefined
              ? "Wynik sprawdzenia (nic nie zapisano)"
              : `Zaimportowano: ${r.inserted}, już były w CRM: ${r.existing}`}
          </p>
          <p className="text-ink-soft mt-1">
            {r.format} · wierszy: {r.total} · poprawnych: {r.valid} · pominiętych (puste/usunięte):{" "}
            {r.skipped} · błędów: {r.errors.length}
          </p>
          {r.errors.length ? (
            <ul className="text-ink-soft mt-2 grid gap-0.5">
              {r.errors.map((e, i) => (
                <li key={i}>
                  Wiersz {e.row}: {CODES[e.code] ?? e.code}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}
