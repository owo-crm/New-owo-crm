"use client";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { Avatar, OrgMark } from "@/components/ui/avatar";
import type { AvatarResult } from "@/lib/avatars/actions";
import { t } from "@/lib/i18n";

/**
 * Загрузка аватарки (решение 039). Браузер сам обрезает картинку до квадрата 256×256
 * и сжимает в WebP — на сервер уходит файл в десятки килобайт, а не фото с телефона на 5 МБ.
 */
async function toSquare(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(
    bitmap,
    (bitmap.width - side) / 2,
    (bitmap.height - side) / 2,
    side,
    side,
    0,
    0,
    256,
    256,
  );
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/webp", 0.86),
  );
  // Старый Safari не умеет WebP в canvas — тогда PNG.
  return blob && blob.type === "image/webp"
    ? blob
    : await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), "image/png"));
}

export function AvatarUpload({
  kind,
  id,
  name,
  src,
  title,
  hint,
  disabled,
  action,
}: {
  kind: "org" | "user";
  id: string;
  name: string;
  src: string | null;
  title: string;
  hint: string;
  disabled?: boolean;
  action: (form: FormData) => Promise<AvatarResult>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const router = useRouter();

  function send(form: FormData) {
    setError(undefined);
    start(async () => {
      const result = await action(form);
      if (result.error) setError(result.error);
      else router.refresh();
    });
  }

  async function pick(file: File | undefined) {
    if (!file) return;
    let blob: Blob;
    try {
      blob = await toSquare(file);
    } catch {
      setError(t("avatar.badType"));
      return;
    }
    const form = new FormData();
    form.set("file", new File([blob], "avatar", { type: blob.type }));
    send(form);
  }

  return (
    <div className="flex items-center gap-4">
      {kind === "org" ? (
        <OrgMark id={id} name={name} src={src} size={56} />
      ) : (
        <Avatar name={name} src={src} size={56} />
      )}
      <div className="grid min-w-0 flex-1 gap-2">
        <div>
          <p className="font-semibold">{title}</p>
          <p className="text-ink-soft text-sm">{hint}</p>
        </div>
        {disabled ? null : (
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={input}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => {
                void pick(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            <Button
              type="button"
              variant="secondary"
              disabled={pending}
              onClick={() => input.current?.click()}
            >
              {pending ? <Loader2 className="animate-spin" /> : null}
              {src ? t("avatar.change") : t("avatar.upload")}
            </Button>
            {src ? (
              <Button
                type="button"
                variant="ghost"
                disabled={pending}
                onClick={() => {
                  const form = new FormData();
                  form.set("remove", "1");
                  send(form);
                }}
              >
                {t("avatar.remove")}
              </Button>
            ) : null}
          </div>
        )}
        {error ? <Notice tone="error">{error}</Notice> : null}
      </div>
    </div>
  );
}
