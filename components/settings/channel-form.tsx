"use client";
import { useActionState } from "react";
import { Field } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { SubmitButton } from "@/components/ui/submit-button";
import { saveWebsiteChannel, type ChannelFormState } from "@/lib/channels/actions";
import { t } from "@/lib/i18n";

export function ChannelForm({
  channel,
}: {
  channel?: { id: string; name: string; origins: string; honeypot: string; forward: string };
}) {
  const [state, action] = useActionState<ChannelFormState, FormData>(saveWebsiteChannel, {});
  return (
    <form action={action} className="grid gap-4">
      {channel ? <input type="hidden" name="id" value={channel.id} /> : null}
      {state.error ? <Notice tone="error">{state.error}</Notice> : null}
      {state.ok ? <Notice tone="success">{t("channels.saved")}</Notice> : null}
      <Field
        name="name"
        label={t("channels.name")}
        placeholder={t("channels.namePlaceholder")}
        defaultValue={channel?.name}
        required
      />
      <Field
        name="origins"
        label={t("channels.origins")}
        hint={t("channels.originsHint")}
        defaultValue={channel?.origins}
        required
      />
      <Field
        name="honeypot"
        label={t("channels.honeypot")}
        hint={t("channels.honeypotHint")}
        defaultValue={channel?.honeypot}
      />
      <Field
        name="forward"
        label={t("channels.forward")}
        hint={t("channels.forwardHint")}
        defaultValue={channel?.forward}
      />
      <div>
        <SubmitButton>{channel ? t("channels.edit") : t("channels.save")}</SubmitButton>
      </div>
    </form>
  );
}
