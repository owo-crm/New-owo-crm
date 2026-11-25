"use client";
import { useState, useTransition } from "react";
import { Copy, KeyRound, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  createOwnerInviteAction,
  revokeOwnerInviteAction,
} from "@/lib/agency/owner-invite-actions";
import { plDateTime } from "@/lib/format";
import { t } from "@/lib/i18n";

/** Zaproszenie pierwszego właściciela kabinetu klienta (tylko admin platformy). */
export function OwnerInvite({
  clientId,
  hasOwner,
  pendingUntil,
}: {
  clientId: string;
  hasOwner: boolean;
  pendingUntil: string | null;
}) {
  const [pending, start] = useTransition();
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (hasOwner) return <p className="text-ink-soft text-sm">{t("agency.owner.hasOwner")}</p>;
  const run = (fn: () => Promise<{ url?: string; error?: string }>) =>
    start(async () => {
      setError(null);
      const res = await fn();
      if (res.error) setError(res.error);
      setUrl(res.url ?? null);
    });
  return (
    <div className="grid gap-3">
      <p className="text-ink-soft text-[13px]">
        {pendingUntil && !url
          ? t("agency.owner.pending", { date: plDateTime(pendingUntil) })
          : t("agency.owner.intro")}
      </p>
      {error ? <p className="text-urgent text-sm">{error}</p> : null}
      {url ? (
        <div className="grid gap-2">
          <input
            readOnly
            value={url}
            className="border-line-strong bg-surface h-10 rounded-lg border px-3 text-sm"
            onFocus={(e) => e.target.select()}
          />
          <p className="text-ink-faint text-[12px]">{t("agency.owner.once")}</p>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {url ? (
          <Button variant="secondary" onClick={() => navigator.clipboard?.writeText(url)}>
            <Copy />
            {t("agency.owner.copy")}
          </Button>
        ) : null}
        <Button
          variant="primary"
          disabled={pending}
          onClick={() => run(() => createOwnerInviteAction(clientId))}
        >
          <KeyRound />
          {pendingUntil || url ? t("agency.owner.reissue") : t("agency.owner.create")}
        </Button>
        {pendingUntil || url ? (
          <Button
            variant="ghost"
            disabled={pending}
            onClick={() => run(() => revokeOwnerInviteAction(clientId))}
          >
            <X />
            {t("agency.owner.revoke")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
