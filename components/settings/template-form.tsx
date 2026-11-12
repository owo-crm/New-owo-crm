"use client";
import { useActionState } from "react";
import { Download, FileText, RotateCcw, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { SubmitButton } from "@/components/ui/submit-button";
import {
  resetTemplateAction,
  uploadTemplateAction,
  type TemplateState,
} from "@/lib/organizations/profile-actions";
import { plDateTime } from "@/lib/format";
import { t } from "@/lib/i18n";

export type TemplateView = { filename: string; size_bytes: number; updated_at: string } | null;

/** Шаблон умовы: встроенный или свой .docx. Поля подставляются по меткам {{...}}. */
export function TemplateForm({
  current,
  fields,
  canEdit,
}: {
  current: TemplateView;
  fields: string[];
  canEdit: boolean;
}) {
  const [upload, uploadAction] = useActionState<TemplateState, FormData>(uploadTemplateAction, {});
  const [reset, resetAction] = useActionState<TemplateState, FormData>(
    () => resetTemplateAction(),
    {},
  );
  return (
    <div className="grid gap-5">
      <div className="border-line bg-surface-2 flex items-start gap-3 rounded-xl border p-4">
        <span className="text-accent bg-accent/10 flex size-9 shrink-0 items-center justify-center rounded-lg">
          <FileText className="size-[18px]" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold">
            {current ? t("templates.own") : t("templates.builtIn")}
            <span className="bg-ok/12 text-ok ml-2 rounded-full px-2 py-0.5 text-[11px] font-semibold">
              {t("templates.inUse")}
            </span>
          </p>
          <p className="text-ink-soft text-sm">
            {current
              ? `${current.filename} · ${t("templates.updated", { date: plDateTime(current.updated_at) })}`
              : t("templates.builtInText")}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <a
          href="/api/szablony/umowa"
          className="border-line-strong hover:bg-surface-2 inline-flex min-h-10 items-center gap-2 rounded-lg border px-3.5 text-[13.5px] font-semibold"
        >
          <Download className="size-4" />
          {t("templates.download")}
        </a>
        {canEdit && current ? (
          <form action={resetAction}>
            <Button type="submit" variant="secondary">
              <RotateCcw />
              {t("templates.reset")}
            </Button>
          </form>
        ) : null}
      </div>

      {canEdit ? (
        <form action={uploadAction} className="border-line grid gap-3 rounded-xl border p-4">
          <label className="text-ink-soft text-[13px] font-medium" htmlFor="template-file">
            {t("templates.upload")}
          </label>
          <input
            id="template-file"
            name="file"
            type="file"
            accept=".docx"
            required
            className="file:border-line-strong file:bg-surface-2 text-[13.5px] file:mr-3 file:rounded-lg file:border file:px-3 file:py-1.5 file:text-[13px] file:font-semibold"
          />
          <p className="text-ink-faint text-[13px]">{t("templates.uploadHint")}</p>
          {upload.message ? <Notice tone="error">{upload.message}</Notice> : null}
          {upload.ok ? <Notice tone="success">{t("templates.saved")}</Notice> : null}
          {reset.ok ? <Notice tone="success">{t("templates.saved")}</Notice> : null}
          <div>
            <SubmitButton variant="secondary">
              <Upload />
              {t("templates.upload")}
            </SubmitButton>
          </div>
        </form>
      ) : null}

      <div>
        <p className="mb-2 font-semibold">{t("templates.fields")}</p>
        <ul className="flex flex-wrap gap-1.5">
          {fields.map((f) => (
            <li
              key={f}
              className="bg-surface-2 text-ink-soft rounded-md px-2 py-1 font-mono text-[12px]"
            >
              {"{{"}
              {f}
              {"}}"}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
