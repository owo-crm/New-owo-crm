"use client";
import { useActionState, useState } from "react";
import { ChevronDown, FileText, Mail, Paperclip } from "lucide-react";
import { Notice } from "@/components/ui/notice";
import { SubmitButton } from "@/components/ui/submit-button";
import { saveTemplateSettingsAction, type InboxResult } from "@/lib/mail/inbox-actions";
import type { Template } from "@/lib/mailing/repository";
import { t, type MessageKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * «Ustawienia → Poczta → Szablony» (решение 053). Видно, какой шаблон — обычное письмо,
 * какой генерирует документ из данных лида, а какой прикладывает готовый PDF.
 */
function kindLabel(x: Template) {
  if (x.purpose === "mail") return { icon: Mail, text: t("chatDocs.typeMail") };
  if (x.document_kind === "file") return { icon: Paperclip, text: t("chatDocs.typeFile") };
  const kind = t(
    `chatDocs.kind${x.document_kind![0].toUpperCase()}${x.document_kind!.slice(1)}` as MessageKey,
  );
  const mode = x.document_mode === "quick" ? t("chatDocs.modeQuick") : t("chatDocs.modeForm");
  const pkg = typeof x.document_params.package === "string" ? ` ${x.document_params.package}` : "";
  return { icon: FileText, text: `${t("chatDocs.typeDocument")}: ${kind}${pkg} · ${mode}` };
}

const input =
  "border-line-strong bg-surface h-9 w-full rounded-lg border px-3 text-[13.5px] font-normal";

function TemplateRow({
  template: x,
  stages,
  canEditDocuments,
}: {
  template: Template;
  stages: { key: string; label: string }[];
  canEditDocuments: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [state, save] = useActionState<InboxResult, FormData>(saveTemplateSettingsAction, {});
  const kind = kindLabel(x);
  const readOnly = x.purpose === "document" && !canEditDocuments;
  const label = (key: MessageKey, el: React.ReactNode, wide = false) => (
    <label className={cn("grid gap-1 text-[12.5px] font-semibold", wide && "sm:col-span-2")}>
      {t(key)}
      {el}
    </label>
  );
  return (
    <li className="border-line rounded-xl border" data-template={x.name}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        <kind.icon
          className={cn(
            "size-4 shrink-0",
            x.purpose === "document" ? "text-accent" : "text-ink-soft",
          )}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-semibold">{x.name}</span>
          <span className="text-ink-soft block truncate text-[12px]">{kind.text}</span>
        </span>
        {x.quick_label ? (
          <span className="bg-surface-2 rounded-full px-2 py-0.5 text-[11.5px] font-semibold">
            {x.quick_label}
          </span>
        ) : null}
        <ChevronDown
          className={cn("text-ink-faint size-4 transition-transform", open && "rotate-180")}
        />
      </button>
      {open ? (
        <form action={save} className="border-line grid gap-3 border-t p-4">
          <input type="hidden" name="id" value={x.id} />
          {state.error ? <Notice tone="error">{state.error}</Notice> : null}
          {state.ok ? <Notice tone="success">{t("chatDocs.saved")}</Notice> : null}
          <fieldset disabled={readOnly} className="grid gap-3 sm:grid-cols-2">
            {label(
              "chatDocs.subject",
              <input name="subject" defaultValue={x.subject} className={input} />,
              true,
            )}
            {label(
              "chatDocs.heading1",
              <input
                name="heading1"
                defaultValue={x.heading1 ?? ""}
                maxLength={60}
                className={cn(input, "text-accent font-bold")}
              />,
            )}
            {label(
              "chatDocs.heading2",
              <input
                name="heading2"
                defaultValue={x.heading2 ?? ""}
                maxLength={60}
                className={cn(input, "font-bold")}
              />,
            )}
            {label(
              "chatDocs.body",
              <textarea
                name="body"
                defaultValue={x.body}
                rows={6}
                className="border-line-strong bg-surface rounded-lg border px-3 py-2 text-[13.5px] font-normal"
              />,
              true,
            )}
            {label(
              "chatDocs.buttonText",
              <input name="buttonText" defaultValue={x.button_text ?? ""} className={input} />,
            )}
            {label(
              "chatDocs.buttonUrl",
              <input name="buttonUrl" defaultValue={x.button_url ?? ""} className={input} />,
            )}
            {label(
              "chatDocs.quickLabel",
              <input
                name="quickLabel"
                defaultValue={x.quick_label ?? ""}
                maxLength={40}
                className={input}
              />,
            )}
            {label(
              "chatDocs.quickPosition",
              <input
                name="quickPosition"
                type="number"
                min={0}
                max={999}
                defaultValue={x.quick_position}
                className={input}
              />,
            )}
            {x.purpose === "document" ? (
              label(
                "chatDocs.stageAfter",
                <select name="stageAfter" defaultValue={x.stage_after ?? ""} className={input}>
                  <option value="">{t("chatDocs.noStage")}</option>
                  {stages.map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.label}
                    </option>
                  ))}
                </select>,
              )
            ) : (
              <input type="hidden" name="stageAfter" value="" />
            )}
          </fieldset>
          {readOnly ? (
            <p className="text-ink-soft text-[12.5px]">{t("chatDocs.forbidden")}</p>
          ) : (
            <div>
              <SubmitButton>{t("chatDocs.save")}</SubmitButton>
            </div>
          )}
        </form>
      ) : null}
    </li>
  );
}

export function TemplatesSettings({
  templates,
  stages,
  canEditDocuments,
}: {
  templates: Template[];
  stages: { key: string; label: string }[];
  canEditDocuments: boolean;
}) {
  return (
    <section className="grid gap-3" id="szablony">
      <div>
        <h2 className="text-[16px] font-bold">{t("chatDocs.templates")}</h2>
        <p className="text-ink-soft mt-1 text-sm">{t("chatDocs.templatesIntro")}</p>
      </div>
      <ul className="grid gap-2">
        {templates.map((x) => (
          <TemplateRow
            key={x.id}
            template={x}
            stages={stages}
            canEditDocuments={canEditDocuments}
          />
        ))}
      </ul>
    </section>
  );
}
