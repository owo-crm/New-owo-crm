"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  AlertTriangle,
  Eye,
  FileText,
  Heading,
  Loader2,
  Paperclip,
  SendHorizontal,
  X,
} from "lucide-react";
import { Picker } from "@/components/ui/picker";
import { Notice } from "@/components/ui/notice";
import {
  previewQuickOfferAction,
  quickOfferDefaultsAction,
  sendChatAction,
} from "@/lib/mail/chat-actions";
import type { QuickOfferValues } from "@/lib/mail/chat-send";
import type { Template } from "@/lib/mailing/repository";
import { formHref } from "@/lib/mailing/quick";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/** Документ, уже созданный формой (оферта personalna, умова, меню) — прикрепляется к письму. */
export type PreparedDocument = { id: string; number: string; fileId: string; filename: string };

const newOperation = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : "00000000-0000-4000-8000-" + String(Date.now()).padStart(12, "0").slice(-12);

/**
 * Поле ответа в чате (решения 051, 053): свой текст, шаблон письма или шаблон документа.
 * Быстрая оферта — карточка документа прямо здесь (данные из лида, правка, «Podgląd PDF»).
 * Каждая отправка — операция с ключом: повторный клик не отправит второе письмо,
 * а «нет ответа от провайдера» не повторяется само (D-20).
 */
export function Composer({
  to,
  leadId,
  templates,
  mailReady,
  defaultSubject,
  initialTemplateId,
  document: prepared,
}: {
  to: string;
  leadId: string | null;
  templates: Template[];
  mailReady: boolean;
  /** Тема по умолчанию: «Re: …» последнего письма или «Wiadomość od …». */
  defaultSubject: string;
  initialTemplateId?: string;
  document?: PreparedDocument | null;
}) {
  const [text, setText] = useState("");
  const [templateId, setTemplateId] = useState(initialTemplateId ?? "");
  const [head, setHead] = useState({ open: false, subject: "", heading1: "", heading2: "" });
  const [values, setValues] = useState<QuickOfferValues | null>(null);
  const [suggested, setSuggested] = useState("");
  const [priceTouched, setPriceTouched] = useState(false);
  const [doc, setDoc] = useState<PreparedDocument | null>(prepared ?? null);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [unknown, setUnknown] = useState<{ documentId: string | null } | null>(null);
  const [operationId, setOperationId] = useState(newOperation);
  const [pending, start] = useTransition();
  const [previewing, startPreview] = useTransition();
  const router = useRouter();
  const area = useRef<HTMLTextAreaElement>(null);
  const template = templates.find((x) => x.id === templateId);
  const isDocument = template?.purpose === "document";
  const quick =
    isDocument && template?.document_mode === "quick" && template.document_kind === "offer";
  const needsForm = isDocument && template?.document_mode === "form" && !doc;
  const autoHeading = (head.subject || defaultSubject)
    .replace(/^\s*((re|odp|aw|fwd?)\s*:\s*)+/i, "")
    .trim();

  // Быстрая оферта: значения из лида и каталога пакета (лид при этом не меняется).
  useEffect(() => {
    if (!quick || !leadId || !template) return;
    let live = true;
    void quickOfferDefaultsAction(leadId, template.id).then((r) => {
      if (!live) return;
      if (r.error) setError(r.error);
      else {
        setValues(r.values ?? null);
        setSuggested(r.suggested ?? "");
        setPriceTouched(false);
      }
    });
    return () => {
      live = false;
    };
  }, [quick, leadId, template]);

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

  const canSend =
    !pending && (template ? !needsForm && (!quick || Boolean(values)) : Boolean(text.trim()));

  function reset() {
    setText("");
    setTemplateId("");
    setValues(null);
    setDoc(null);
    setHead({ open: false, subject: "", heading1: "", heading2: "" });
    setOperationId(newOperation());
    setUnknown(null);
  }

  function send(opId = operationId, documentId = doc?.id) {
    if (!canSend) return;
    setError(undefined);
    setNotice(undefined);
    start(async () => {
      const result = await sendChatAction({
        operationId: opId,
        leadId: leadId ?? undefined,
        to: leadId ? undefined : to,
        templateId: template?.id,
        documentId,
        values: quick ? (values ?? undefined) : undefined,
        text: template ? "" : text,
        subject: !template ? head.subject || undefined : undefined,
        heading1: !template ? head.heading1 || undefined : undefined,
        heading2: !template ? head.heading2 || undefined : undefined,
      });
      if (result.status === "sent") {
        reset();
        setNotice(t("chatDocs.sent"));
        router.refresh();
      } else if (result.status === "unknown") {
        setUnknown({ documentId: result.documentId });
      } else if (result.status === "pending") {
        setNotice(t("chatDocs.pending"));
      } else {
        setError(result.text ?? t("mail.errors.send_failed"));
      }
    });
  }

  function preview() {
    if (!leadId || !template || !values) return;
    setError(undefined);
    startPreview(async () => {
      const result = await previewQuickOfferAction(leadId, template.id, values);
      if (result.error || !result.pdf) {
        setError(result.error ?? t("mail.errors.send_failed"));
        return;
      }
      const bytes = Uint8Array.from(atob(result.pdf), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
      window.open(url, "_blank", "noopener");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    });
  }

  async function guestsChanged(guests: string) {
    if (!leadId || !template || !/^\d{1,5}$/.test(guests)) return;
    const r = await quickOfferDefaultsAction(leadId, template.id, guests);
    if (r.suggested) {
      setSuggested(r.suggested);
      if (!priceTouched) setValues((v) => (v ? { ...v, price: r.suggested! } : v));
    }
  }

  const field = (key: keyof QuickOfferValues, label: string, extra?: string) => (
    <label className={cn("grid gap-1 text-[12px] font-semibold", extra)}>
      {label}
      <input
        value={values?.[key] ?? ""}
        disabled={!values || pending}
        inputMode={key === "guests" || key === "price" ? "numeric" : undefined}
        onChange={(e) => {
          const v = e.target.value;
          setValues((old) => (old ? { ...old, [key]: v } : old));
          if (key === "price") setPriceTouched(true);
        }}
        onBlur={(e) => key === "guests" && void guestsChanged(e.target.value)}
        className="border-line-strong bg-surface h-9 min-w-0 rounded-lg border px-2.5 text-[13.5px] font-normal"
      />
    </label>
  );

  return (
    <div className="border-line bg-surface grid gap-2 border-t p-3">
      {error ? <Notice tone="error">{error}</Notice> : null}
      {notice ? <Notice tone="success">{notice}</Notice> : null}
      {unknown ? (
        <div className="border-hold/40 bg-hold/10 grid gap-2 rounded-xl border p-3 text-[13px]">
          <p className="flex gap-2">
            <AlertTriangle className="text-hold mt-0.5 size-4 shrink-0" />
            {t("chatDocs.unknown")}
          </p>
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              // Ручное решение: новая операция, тот же документ (не генерируем второй).
              const next = newOperation();
              setOperationId(next);
              send(next, unknown.documentId ?? undefined);
            }}
            className="border-line-strong hover:bg-surface-2 justify-self-start rounded-lg border px-3 py-1.5 text-[12.5px] font-semibold"
          >
            {t("chatDocs.sendAgain")}
          </button>
        </div>
      ) : null}

      {template ? (
        <div className="border-line bg-surface-2 grid gap-3 rounded-xl border p-3">
          <div className="flex items-start gap-3">
            <FileText className="text-accent mt-0.5 size-4 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold">{template.name}</p>
              <p className="text-ink-soft truncate text-[12.5px]">{template.subject}</p>
            </div>
            <button
              type="button"
              aria-label={t("inbox.dropTemplate")}
              onClick={() => {
                setTemplateId("");
                setValues(null);
                setDoc(null);
              }}
              className="text-ink-faint hover:text-ink rounded p-0.5"
            >
              <X className="size-4" />
            </button>
          </div>

          {quick ? (
            <div className="grid gap-2" data-document-card>
              <p className="text-ink-faint text-[11.5px]">{t("chatDocs.quickHint")}</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                {field("date", t("chatDocs.date"))}
                {field("venue", t("chatDocs.venue"), "col-span-2 sm:col-span-1")}
                {field("guests", t("chatDocs.guests"))}
                {field("hours", t("chatDocs.hours"))}
                {field("price", t("chatDocs.price"))}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={preview}
                  disabled={!values || previewing}
                  className="border-line-strong hover:bg-surface flex h-8 items-center gap-1.5 rounded-lg border px-3 text-[12.5px] font-semibold disabled:opacity-50"
                >
                  {previewing ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Eye className="size-3.5" />
                  )}
                  {previewing ? t("chatDocs.previewing") : t("chatDocs.preview")}
                </button>
                {suggested ? (
                  <span className="text-ink-faint text-[11.5px]">
                    {t("chatDocs.suggested", { price: suggested })}
                  </span>
                ) : null}
              </div>
            </div>
          ) : null}

          {doc ? (
            <a
              href={`/api/documents/${doc.fileId}`}
              className="border-line bg-surface flex items-center gap-2 justify-self-start rounded-lg border px-3 py-2 text-[12.5px] font-semibold"
            >
              <Paperclip className="size-3.5" />
              {doc.filename}
            </a>
          ) : null}
          {template.document_kind === "file" ? (
            <span className="text-ink-soft flex items-center gap-2 text-[12.5px]">
              <Paperclip className="size-3.5" />
              {t("chatDocs.typeFile")}
            </span>
          ) : null}
          {needsForm && leadId ? (
            <Link
              href={formHref(template, leadId)}
              className="bg-ink text-bg justify-self-start rounded-lg px-3 py-2 text-[12.5px] font-semibold"
            >
              {t("chatDocs.fillForm")}
            </Link>
          ) : null}
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
            onChange={(e) => {
              setTemplateId(e.target.value);
              setValues(null);
              setError(undefined);
              if (doc && e.target.value !== initialTemplateId) setDoc(null);
            }}
            menuClassName="min-w-[16rem]"
            trigger={
              <span className="border-line-strong hover:bg-surface-2 flex h-9 items-center gap-1.5 rounded-lg border px-3 text-[13px] font-semibold">
                <FileText className="size-4" />
                {t("inbox.template")}
              </span>
            }
          >
            <option value="">{t("inbox.noTemplate")}</option>
            {templates
              // документные шаблоны имеют смысл только в переписке с лидом
              .filter((x) => x.purpose === "mail" || leadId)
              .map((x) => (
                <option key={x.id} value={x.id}>
                  {x.purpose === "document" ? `📎 ${x.name}` : x.name}
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
          onClick={() => send()}
          disabled={!canSend}
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
          {pending ? t("chatDocs.sending") : t("inbox.send")}
        </button>
      </div>
    </div>
  );
}
