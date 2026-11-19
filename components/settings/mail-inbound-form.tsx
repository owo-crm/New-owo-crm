"use client";
import { useActionState, useEffect, useState, useTransition } from "react";
import { Copy } from "lucide-react";
import { Field } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { SubmitButton } from "@/components/ui/submit-button";
import {
  previewLookAction,
  saveInboundSecretAction,
  saveLetterLookAction,
  type InboxResult,
} from "@/lib/mail/inbox-actions";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

function Result({ state }: { state: InboxResult }) {
  if (state.error) return <Notice tone="error">{state.error}</Notice>;
  if (state.ok) return <Notice tone="success">{t("inbox.saved")}</Notice>;
  return null;
}

/** Приём писем: адрес вебхука для Resend и его секрет (решение 051). */
export function MailInboundForm({
  webhookUrl,
  secretSet,
  lastAt,
  canEdit,
}: {
  webhookUrl: string;
  secretSet: boolean;
  lastAt: string | null;
  canEdit: boolean;
}) {
  const [state, save] = useActionState(saveInboundSecretAction, {});
  const [copied, setCopied] = useState(false);
  return (
    <form action={save} className="grid gap-4">
      <div>
        <h2 className="text-[16px] font-bold">{t("inbox.inboundTitle")}</h2>
        <p className="text-ink-soft mt-1 text-sm">{t("inbox.inboundIntro")}</p>
      </div>
      <Result state={state} />
      <div className="grid gap-1.5">
        <span className="text-[13px] font-semibold">{t("inbox.inboundUrl")}</span>
        <div className="flex gap-2">
          <code className="border-line bg-surface-2 min-w-0 flex-1 truncate rounded-lg border px-3 py-2 text-[12.5px]">
            {webhookUrl}
          </code>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard?.writeText(webhookUrl);
              setCopied(true);
            }}
            className="border-line-strong hover:bg-surface-2 flex items-center gap-1.5 rounded-lg border px-3 text-[13px] font-semibold"
          >
            <Copy className="size-4" />
            {copied ? "✓" : ""}
          </button>
        </div>
      </div>
      <Field
        name="secret"
        type="password"
        autoComplete="off"
        label={t("inbox.inboundSecret")}
        hint={secretSet ? t("inbox.inboundSet") : undefined}
        placeholder="whsec_…"
        disabled={!canEdit}
      />
      <p className="text-ink-soft text-[12.5px]">
        {lastAt
          ? t("inbox.inboundLast", {
              when: new Date(lastAt).toLocaleString("pl-PL", { timeZone: "Europe/Warsaw" }),
            })
          : t("inbox.inboundNever")}{" "}
        {t("inbox.inboundKeyNote")}
      </p>
      {canEdit ? (
        <div>
          <SubmitButton>{t("common.save")}</SubmitButton>
        </div>
      ) : null}
    </form>
  );
}

/** Внешний вид писем: тема, цвет кнопок, подпись — с живым предпросмотром. */
export function LetterLookForm({
  initial,
  canEdit,
}: {
  initial: { theme: "light" | "dark"; accent: string; signature: string };
  canEdit: boolean;
}) {
  const [state, save] = useActionState(saveLetterLookAction, {});
  const [look, setLook] = useState(initial);
  const [html, setHtml] = useState<string>();
  const [, start] = useTransition();

  useEffect(() => {
    const id = setTimeout(
      () =>
        start(async () => {
          const result = await previewLookAction(look);
          if (result.html) setHtml(result.html);
        }),
      250,
    );
    return () => clearTimeout(id);
  }, [look]);

  return (
    <form action={save} className="grid gap-4">
      <div>
        <h2 className="text-[16px] font-bold">{t("inbox.lookTitle")}</h2>
        <p className="text-ink-soft mt-1 text-sm">{t("inbox.lookIntro")}</p>
      </div>
      <Result state={state} />
      <div className="grid gap-1.5">
        <span className="text-[13px] font-semibold">{t("inbox.theme")}</span>
        <input type="hidden" name="theme" value={look.theme} />
        <div className="flex gap-2">
          {(["light", "dark"] as const).map((theme) => (
            <button
              key={theme}
              type="button"
              disabled={!canEdit}
              onClick={() => setLook({ ...look, theme })}
              aria-pressed={look.theme === theme}
              className={cn(
                "flex h-10 flex-1 items-center justify-center gap-2 rounded-lg border text-[13.5px] font-semibold",
                look.theme === theme ? "border-ink" : "border-line-strong text-ink-soft",
              )}
            >
              <span
                className="size-4 rounded-full border"
                style={{ background: theme === "dark" ? "#141417" : "#ffffff" }}
              />
              {t(theme === "dark" ? "inbox.themeDark" : "inbox.themeLight")}
            </button>
          ))}
        </div>
      </div>
      <label className="grid gap-1.5 text-[13px] font-semibold">
        {t("inbox.accent")}
        <span className="flex items-center gap-2">
          <input
            type="color"
            name="accent"
            value={look.accent}
            disabled={!canEdit}
            onChange={(e) => setLook({ ...look, accent: e.target.value })}
            className="border-line-strong h-10 w-14 rounded-lg border"
          />
          <code className="text-ink-soft text-[12.5px] font-normal">{look.accent}</code>
        </span>
      </label>
      <label className="grid gap-1.5 text-[13px] font-semibold">
        {t("inbox.signature")}
        <textarea
          name="signature"
          rows={3}
          maxLength={500}
          value={look.signature}
          disabled={!canEdit}
          onChange={(e) => setLook({ ...look, signature: e.target.value })}
          placeholder={t("inbox.signatureHint")}
          className="border-line-strong bg-surface rounded-lg border px-3 py-2 text-[14px] font-normal"
        />
      </label>
      <div className="grid gap-1.5">
        <span className="text-[13px] font-semibold">{t("inbox.preview")}</span>
        <iframe
          title={t("inbox.preview")}
          sandbox=""
          srcDoc={html}
          className="border-line h-[34rem] w-full rounded-xl border bg-white"
        />
      </div>
      {canEdit ? (
        <div>
          <SubmitButton>{t("common.save")}</SubmitButton>
        </div>
      ) : null}
    </form>
  );
}
