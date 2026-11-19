"use client";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { FileText, Heading, Loader2, SendHorizontal, X } from "lucide-react";
import { Picker } from "@/components/ui/picker";
import { Notice } from "@/components/ui/notice";
import { sendReplyAction } from "@/lib/mail/inbox-actions";
import type { Template } from "@/lib/mailing/repository";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * Поле ответа: свой текст или шаблон. Шаблон уходит оформленным письмом (заголовок, кнопка),
 * текст — тем же оформлением фирмы, но без заголовка. Ctrl/⌘+Enter — отправить.
 */
export function Composer({
  to,
  templates,
  mailReady,
  defaultSubject,
}: {
  /** Тема по умолчанию: «Re: …» последнего письма или «Wiadomość od …». */
  defaultSubject: string;
  to: string;
  templates: Template[];
  mailReady: boolean;
}) {
  const [text, setText] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [head, setHead] = useState({ open: false, subject: "", heading1: "", heading2: "" });
  const autoHeading = (head.subject || defaultSubject)
    .replace(/^\s*((re|odp|aw|fwd?)\s*:\s*)+/i, "")
    .trim();
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const router = useRouter();
  const area = useRef<HTMLTextAreaElement>(null);
  const template = templates.find((x) => x.id === templateId);

  if (!mailReady)
    return (
      <div className="border-line border-t p-4">
        <p className="text-ink-soft text-sm">
          {t("inbox.notReady")}{" "}
          <Link href="/ustawienia/poczta" className="text-ink font-semibold underline">
            {t("mailing.settings")}
          </Link>
        </p>
      </div>
    );

  function send() {
    if (pending || (!template && !text.trim())) return;
    setError(undefined);
    start(async () => {
      const result = await sendReplyAction({
        to,
        text,
        templateId: template?.id,
        subject: head.subject || undefined,
        heading1: head.heading1 || undefined,
        heading2: head.heading2 || undefined,
      });
      if (result.error) setError(result.error);
      else {
        setText("");
        setTemplateId("");
        setHead({ open: false, subject: "", heading1: "", heading2: "" });
        router.refresh();
      }
    });
  }

  return (
    <div className="border-line bg-surface grid gap-2 border-t p-3">
      {error ? <Notice tone="error">{error}</Notice> : null}
      {template ? (
        <div className="border-line bg-surface-2 flex items-start gap-3 rounded-xl border p-3">
          <FileText className="text-accent mt-0.5 size-4 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold">{template.name}</p>
            <p className="text-ink-soft truncate text-[12.5px]">{template.subject}</p>
          </div>
          <button
            type="button"
            aria-label={t("inbox.dropTemplate")}
            onClick={() => setTemplateId("")}
            className="text-ink-faint hover:text-ink rounded p-0.5"
          >
            <X className="size-4" />
          </button>
        </div>
      ) : (
        <>
          {head.open ? (
            <div className="grid gap-2 sm:grid-cols-3">
              <input
                value={head.subject}
                onChange={(e) => setHead({ ...head, subject: e.target.value })}
                maxLength={200}
                aria-label={t("inbox.subject")}
                placeholder={`${t("inbox.subject")}: ${defaultSubject}`}
                className="border-line-strong bg-surface h-9 rounded-lg border px-3 text-[13px] sm:col-span-3"
              />
              <input
                value={head.heading1}
                onChange={(e) => setHead({ ...head, heading1: e.target.value })}
                maxLength={60}
                aria-label={t("inbox.heading1")}
                placeholder={t("inbox.heading1")}
                className="border-line-strong bg-surface text-accent h-9 rounded-lg border px-3 text-[13px] font-bold"
              />
              <input
                value={head.heading2}
                onChange={(e) => setHead({ ...head, heading2: e.target.value })}
                maxLength={60}
                aria-label={t("inbox.heading2")}
                placeholder={autoHeading || t("inbox.heading2")}
                className="border-line-strong bg-surface h-9 rounded-lg border px-3 text-[13px] font-bold sm:col-span-2"
              />
            </div>
          ) : null}
          <textarea
            ref={area}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                send();
              }
            }}
            rows={3}
            placeholder={t("inbox.placeholder")}
            className="border-line-strong bg-surface focus:border-ink max-h-60 min-h-20 w-full resize-y rounded-xl border px-3 py-2.5 text-[14px] outline-none"
          />
        </>
      )}
      <div className="flex items-center gap-2">
        {templates.length ? (
          <Picker
            aria-label={t("inbox.template")}
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value)}
            menuClassName="min-w-[16rem]"
            trigger={
              <span className="border-line-strong hover:bg-surface-2 flex h-9 items-center gap-1.5 rounded-lg border px-3 text-[13px] font-semibold">
                <FileText className="size-4" />
                {t("inbox.template")}
              </span>
            }
          >
            <option value="">{t("inbox.noTemplate")}</option>
            {templates.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </Picker>
        ) : null}
        {!template ? (
          <button
            type="button"
            aria-pressed={head.open}
            onClick={() => setHead({ ...head, open: !head.open })}
            className={cn(
              "border-line-strong hover:bg-surface-2 flex h-9 items-center gap-1.5 rounded-lg border px-3 text-[13px] font-semibold",
              head.open && "bg-surface-2",
            )}
          >
            <Heading className="size-4" />
            {t("inbox.headingToggle")}
          </button>
        ) : null}
        <span className="text-ink-faint hidden flex-1 text-[11.5px] md:block">
          {t("inbox.hint")}
        </span>
        <button
          type="button"
          onClick={send}
          disabled={pending || (!template && !text.trim())}
          className={cn(
            "bg-accent text-accent-ink ml-auto flex h-9 items-center gap-2 rounded-lg px-4 text-[13.5px] font-semibold transition-opacity",
            "disabled:opacity-40",
          )}
        >
          {pending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <SendHorizontal className="size-4" />
          )}
          {t("inbox.send")}
        </button>
      </div>
    </div>
  );
}
