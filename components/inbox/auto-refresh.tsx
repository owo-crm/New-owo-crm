"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Переписка обновляется сама раз в 10 секунд, пока вкладка открыта: новые ответы клиента
 * и статусы («Dostarczono», «Otwarto») появляются без перезагрузки страницы.
 * Набранный текст в поле ответа при этом не теряется.
 */
export function AutoRefresh({ everyMs = 10_000 }: { everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const id = setInterval(tick, everyMs);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [router, everyMs]);
  return null;
}
