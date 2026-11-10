"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { t } from "@/lib/i18n";
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
  return (
    <div className="text-ink-soft flex items-center gap-3 text-xs">
      <span className={connected ? "text-ok" : undefined}>
        {t(connected ? "leads.live" : "leads.liveOffline")}
      </span>
      <Button variant="ghost" onClick={() => router.refresh()}>
        {t("leads.refresh")}
      </Button>
    </div>
  );
}
