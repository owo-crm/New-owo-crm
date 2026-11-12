"use client";
import { useRef, useState, useTransition } from "react";
import { Download, Paperclip, Trash2, Upload } from "lucide-react";
import { Card } from "@/components/app-shell/page";
import { Button } from "@/components/ui/button";
import { deleteAttachmentAction, uploadAttachmentAction } from "@/lib/documents/attachment-actions";
import type { Attachment } from "@/lib/documents/attachments";
import { plDateTime } from "@/lib/format";
import { t } from "@/lib/i18n";

/**
 * Свои файлы у лида (решение 038). Раньше в карточке были только сгенерированные
 * документы, поэтому скан подписанной умовы или план зала класть было некуда.
 */

const sizeLabel = (bytes: number) =>
  bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;

export function AttachmentsCard({ leadId, files }: { leadId: string; files: Attachment[] }) {
  const form = useRef<HTMLFormElement>(null);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();

  return (
    <Card title={t("attachments.title")} tone="var(--ink-faint)">
      <p className="text-ink-soft -mt-1 mb-3 text-[13px]">{t("attachments.intro")}</p>

      {files.length === 0 ? (
        <p className="text-ink-soft text-[13.5px]">{t("attachments.empty")}</p>
      ) : (
        <ul className="divide-line divide-y">
          {files.map((file) => (
            <li key={file.id} className="flex items-center gap-3 py-2 first:pt-0">
              <Paperclip className="text-ink-faint size-4 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] font-medium">{file.filename}</span>
                <span className="text-ink-faint block truncate text-[12px]">
                  {sizeLabel(file.size_bytes)} · {plDateTime(file.created_at)}
                  {file.note ? ` · ${file.note}` : ""}
                </span>
              </span>
              <a
                href={`/api/zalaczniki/${file.id}`}
                className="text-ink-soft hover:text-ink flex size-9 items-center justify-center rounded-lg"
                aria-label={`${t("attachments.title")}: ${file.filename}`}
              >
                <Download className="size-4" />
              </a>
              <Button
                size="icon"
                variant="ghost"
                disabled={pending}
                aria-label={`${t("attachments.remove")}: ${file.filename}`}
                onClick={() =>
                  start(async () => {
                    const r = await deleteAttachmentAction(file.id, leadId);
                    setError(r.error);
                  })
                }
              >
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <form
        ref={form}
        className="border-line mt-3 grid gap-2 border-t pt-3"
        onSubmit={(e) => {
          e.preventDefault();
          const data = new FormData(e.currentTarget);
          data.set("leadId", leadId);
          start(async () => {
            const r = await uploadAttachmentAction(data);
            setError(r.error);
            if (!r.error) form.current?.reset();
          });
        }}
      >
        <input
          type="file"
          name="file"
          required
          className="text-ink-soft file:border-line-strong file:bg-surface-2 file:text-ink text-[13px] file:mr-3 file:rounded-lg file:border file:px-3 file:py-1.5 file:text-[13px] file:font-semibold"
        />
        <div className="flex flex-wrap gap-2">
          <input
            name="note"
            maxLength={300}
            placeholder={t("attachments.note")}
            aria-label={t("attachments.note")}
            className="border-line-strong bg-surface h-10 min-w-0 flex-1 rounded-lg border px-3 text-[13.5px] lg:h-9"
          />
          <Button type="submit" variant="secondary" disabled={pending}>
            <Upload />
            {pending ? t("attachments.uploading") : t("attachments.add")}
          </Button>
        </div>
        {error ? <p className="text-urgent text-[12.5px]">{error}</p> : null}
      </form>
    </Card>
  );
}
