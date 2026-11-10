"use client";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { subscribePush, unsubscribePush } from "@/lib/notify/push-actions";
import { t } from "@/lib/i18n";
export function PushManager({ publicKey, enabled }: { publicKey: string; enabled: boolean }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string>();
  const [subscription, setSubscription] = useState<PushSubscription | null>(null);
  async function enable() {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setMessage(t("pwa.unsupported"));
      return;
    }
    try {
      if ((await Notification.requestPermission()) !== "granted") {
        setMessage(t("pwa.denied"));
        return;
      }
      await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
      const registration = await navigator.serviceWorker.ready;
      const base64 = publicKey.replace(/-/g, "+").replace(/_/g, "/");
      const key = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
      const existing = await registration.pushManager.getSubscription();
      const sub =
        existing ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: key,
        }));
      const result = await subscribePush(sub.toJSON());
      if (result.error) {
        if (!existing) await sub.unsubscribe();
        setMessage(result.error);
      } else {
        setSubscription(sub);
        setMessage(t("pwa.enabled"));
      }
    } catch {
      setMessage(t("pwa.failed"));
    }
  }
  async function disable() {
    try {
      const registration = await navigator.serviceWorker.getRegistration("/");
      const sub = subscription ?? (await registration?.pushManager.getSubscription());
      if (sub) {
        const result = await unsubscribePush(sub.endpoint);
        if (result.error) {
          setMessage(result.error);
          return;
        }
        await sub.unsubscribe();
      }
      setSubscription(null);
      setMessage(t("pwa.disabled"));
    } catch {
      setMessage(t("pwa.failed"));
    }
  }
  return (
    <div className="mt-4 grid gap-3">
      <p className="text-ink-soft text-sm">{t(enabled ? "pwa.permissionHint" : "pwa.notReady")}</p>
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={pending || !enabled || !publicKey}
          onClick={() => startTransition(enable)}
        >
          {t("pwa.enable")}
        </Button>
        <Button variant="secondary" disabled={pending} onClick={() => startTransition(disable)}>
          {t("pwa.disable")}
        </Button>
      </div>
      {message ? (
        <p role="status" className="text-sm">
          {message}
        </p>
      ) : null}
    </div>
  );
}
