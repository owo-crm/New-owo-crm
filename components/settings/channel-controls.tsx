"use client";

import Link from "next/link";
import { useActionState, useState, useTransition } from "react";
import { Copy, Pause, Play, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { SubmitButton } from "@/components/ui/submit-button";
import {
  createWebhookChannel,
  saveFieldMap,
  sendTestLead,
  setChannelStatus,
  type ChannelFormState,
} from "@/lib/channels/actions";
import { t } from "@/lib/i18n";

/** Адрес канала с кнопкой «Kopiuj». */
export function EndpointBox({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="bg-surface-2 flex items-start gap-2 rounded-lg p-2.5">
      <code className="min-w-0 flex-1 text-[13px] break-all select-all">{url}</code>
      <Button
        size="sm"
        variant="ghost"
        aria-label="Kopiuj"
        onClick={() => {
          void navigator.clipboard?.writeText(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        <Copy />
        {copied ? "✓" : null}
      </Button>
    </div>
  );
}

/** «Wyślij test» и «Wstrzymaj/Włącz». */
export function ChannelActions({ id, active }: { id: string; active: boolean }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ ok?: boolean; error?: string; leadId?: string }>();
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="soft"
          disabled={pending || !active}
          onClick={() => start(async () => setResult(await sendTestLead(id)))}
        >
          <Send />
          {t("channels.test")}
        </Button>
        <Button
          size="sm"
          variant={active ? "ghost" : "success"}
          disabled={pending}
          onClick={() => start(async () => setResult(await setChannelStatus(id, !active)))}
        >
          {active ? <Pause /> : <Play />}
          {t(active ? "channels.pause" : "channels.resume")}
        </Button>
      </div>
      {result?.error ? <Notice tone="error">{result.error}</Notice> : null}
      {result?.ok && result.leadId ? (
        <Notice tone="success">
          {t("channels.testOk")}{" "}
          <Link href={`/leady/${result.leadId}`} className="underline">
            →
          </Link>
        </Notice>
      ) : null}
    </div>
  );
}

/** Свои названия полей вебхука. */
export function FieldMapForm({ id, initial }: { id: string; initial: string }) {
  const [text, setText] = useState(initial);
  const [pending, start] = useTransition();
  const [state, setState] = useState<ChannelFormState>({});
  return (
    <div className="grid gap-2">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        placeholder={"telefon_klienta = phone\nkto = name"}
        className="border-line-strong bg-surface rounded-lg border p-3 font-mono text-[13px]"
        aria-label={t("channels.mapTitle")}
      />
      <div className="flex items-center gap-3">
        <Button
          size="sm"
          variant="secondary"
          disabled={pending}
          onClick={() => start(async () => setState(await saveFieldMap(id, text)))}
        >
          {t("channels.mapSave")}
        </Button>
        {state.error ? <span className="text-urgent text-[13px]">{state.error}</span> : null}
        {state.ok ? <span className="text-ok text-[13px]">{t("channels.saved")}</span> : null}
      </div>
    </div>
  );
}

export function WebhookForm() {
  const [state, action] = useActionState<ChannelFormState, FormData>(createWebhookChannel, {});
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
      <Field name="name" label={t("channels.webhookName")} placeholder="Zapier" required />
      <SubmitButton size="md">{t("channels.addWebhook")}</SubmitButton>
      {state.error ? <Notice tone="error">{state.error}</Notice> : null}
      {state.ok ? <Notice tone="success">{t("channels.saved")}</Notice> : null}
    </form>
  );
}
