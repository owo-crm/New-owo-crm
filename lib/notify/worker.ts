import { runNotifications } from "./runner";

/**
 * Фоновый воркер внутри того же процесса Next.js (монолит, один контейнер на Railway).
 * Раз в минуту: напоминания 15 мин / 2 ч, повторы неудачных доставок, уборка.
 */
const INTERVAL_MS = 60_000;
const state = globalThis as typeof globalThis & { __owoWorker?: NodeJS.Timeout };

export function startNotificationWorker() {
  if (state.__owoWorker || process.env.NOTIFICATION_WORKER === "off") return;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runNotifications();
    } catch (error) {
      console.error("[worker]", (error as Error).message);
    } finally {
      running = false;
    }
  };
  state.__owoWorker = setInterval(tick, INTERVAL_MS);
  state.__owoWorker.unref?.();
  setTimeout(tick, 5_000).unref?.();
  console.info("[worker] notifications: co 60 s");
}
