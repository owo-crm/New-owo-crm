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
  // Подключение работает всегда (в том числе на телефоне); на узком экране скрыта только подпись.
  return (
    <div className="text-ink-soft flex items-center gap-2 text-xs">
      <span
        aria-hidden
        className={cn("size-1.5 rounded-full", connected ? "bg-ok" : "bg-ink-faint")}
      />
      <span className={cn("max-sm:sr-only", connected && "text-ok")}>
        {t(connected ? "leads.live" : "leads.liveOffline")}
      </span>
      <Button variant="ghost" size="sm" onClick={() => router.refresh()}>
        {t("leads.refresh")}
      </Button>
    </div>
  );
}
