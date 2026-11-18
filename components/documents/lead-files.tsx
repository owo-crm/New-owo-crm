"use client";
import { useRef, useState, useTransition } from "react";
import { FileUp, ImagePlus, Paperclip, Trash2 } from "lucide-react";
import { deleteAttachmentAction, uploadAttachmentAction } from "@/lib/documents/attachment-actions";
import type { Attachment } from "@/lib/documents/attachments";
import { t } from "@/lib/i18n";

/**
 * Файлы лида внутри «Dokumenty i płatności» (решение 049): «Galeria» открывает фото,
 * «Plik» — документы; файл загружается сразу после выбора, без лишних полей.
 */
export function LeadFiles({ leadId, files }: { leadId: string; files: Attachment[] }) {
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const gallery = useRef<HTMLInputElement>(null);
  const doc = useRef<HTMLInputElement>(null);

  function upload(input: HTMLInputElement) {
    const file = input.files?.[0];
    if (!file) return;
    const data = new FormData();
    data.set("leadId", leadId);
    data.set("file", file);
    start(async () => {
      const r = await uploadAttachmentAction(data);
      setError(r.error);
      input.value = "";
    });
  }

  const pick =
    "border-line hover:border-line-strong text-ink-soft hover:text-ink inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[12.5px] font-semibold transition-colors disabled:opacity-50";
  return (
    <div className="grid gap-2">
      {files.length ? (
        <ul className="grid gap-1">
          {files.slice(0, 5).map((file) => (
            <li key={file.id} className="group flex items-center gap-2 text-[13px]">
              <Paperclip className="text-ink-faint size-3.5 shrink-0" aria-hidden />
              <a
                href={`/api/zalaczniki/${file.id}`}
                className="min-w-0 flex-1 truncate hover:underline"
              >
                {file.filename}
              </a>
              <button
                type="button"
                disabled={pending}
                aria-label={`${t("attachments.remove")}: ${file.filename}`}
                onClick={() =>
                  start(async () => setError((await deleteAttachmentAction(file.id, leadId)).error))
                }
                className="text-ink-faint hover:text-urgent opacity-60 group-hover:opacity-100"
              >
                <Trash2 className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          className={pick}
          disabled={pending}
          onClick={() => gallery.current?.click()}
        >
          <ImagePlus className="size-4" />
          {t("attachments.gallery")}
        </button>
        <button
          type="button"
          className={pick}
          disabled={pending}
          onClick={() => doc.current?.click()}
        >
          <FileUp className="size-4" />
          {pending ? t("attachments.uploading") : t("attachments.file")}
        </button>
        <input
          ref={gallery}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => upload(e.currentTarget)}
        />
        <input ref={doc} type="file" hidden onChange={(e) => upload(e.currentTarget)} />
      </div>
      {error ? <p className="text-urgent text-[12.5px]">{error}</p> : null}
    </div>
  );
}
