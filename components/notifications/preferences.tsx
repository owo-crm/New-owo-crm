"use client";
import { useState, useTransition } from "react";
import { Checkbox } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { t } from "@/lib/i18n";
import { saveNotificationPreference } from "@/lib/notify/preferences";
import { createTelegramLink } from "@/lib/notify/link-action";
export function NotificationPreferences({
  initial,
  telegramReady,
}: {
  initial: { channel: "telegram" | "push" | "email"; enabled: boolean }[];
  telegramReady: boolean;
}) {
  const [values, setValues] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string>();
  const [link, setLink] = useState<string>();
  return (
    <div className="grid gap-5">
      <p className="text-ink-soft text-sm">{t("notifications.preferenceHint")}</p>
      {values.map((row) => (
        <Checkbox
          key={row.channel}
          label={t(`notifications.channel.${row.channel}`)}
          checked={row.enabled}
          disabled={pending}
          onChange={(e) => {
            const enabled = e.target.checked;
            setValues((current) =>
              current.map((item) => (item.channel === row.channel ? { ...item, enabled } : item)),
            );
            startTransition(async () => {
              const result = await saveNotificationPreference(row.channel, enabled);
              if (result.error) {
                setMessage(result.error);
                setValues((current) =>
                  current.map((item) =>
                    item.channel === row.channel ? { ...item, enabled: row.enabled } : item,
                  ),
                );
              } else
                setValues((current) =>
                  current.map((item) =>
                    item.channel === row.channel ? { ...item, enabled } : item,
                  ),
                );
            });
          }}
        />
      ))}
      <Button
        disabled={pending || !telegramReady}
        onClick={() =>
          startTransition(async () => {
            const result = await createTelegramLink();
            if (result.url) setLink(result.url);
            else setMessage(t("notifications.linkFailed"));
          })
        }
      >
        {t("notifications.connectTelegram")}
      </Button>
      {link ? (
        <a href={link} target="_blank" rel="noreferrer" className="underline">
          {t("notifications.openTelegram")}
        </a>
      ) : null}
      {message ? (
        <p role="status" className="text-sm">
          {message}
        </p>
      ) : null}
    </div>
  );
}
