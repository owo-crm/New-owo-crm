"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
export function LiveUpdates({ organizationId }: { organizationId: string }) {
  const router = useRouter();
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const source = new EventSource(`/api/live?org=${encodeURIComponent(organizationId)}`);
    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);
    source.onmessage = () => {
      clearTimeout(timer);
      timer = setTimeout(() => router.refresh(), 200);
    };
    return () => {
      clearTimeout(timer);
      source.close();
    };
  }, [organizationId, router]);
  // Пока связь есть, показывать нечего: новые лиды приезжают сами. Компонент остаётся
  // в дереве (иначе оборвётся подписка), но ничего не рисует. Кнопка обновления
  // появляется только тогда, когда она действительно нужна — когда связь пропала.
  if (connected)
    return (
      <span data-live="on" className="sr-only">
        {t("leads.live")}
      </span>
    );
  return (
    <div data-live="off" className="text-ink-soft flex items-center gap-2 text-xs">
      <span aria-hidden className="bg-ink-faint size-1.5 rounded-full" />
      <span className="sr-only">{t("leads.liveOffline")}</span>
      <Button variant="ghost" size="sm" onClick={() => router.refresh()}>
        {t("leads.refresh")}
      </Button>
    </div>
  );
}
