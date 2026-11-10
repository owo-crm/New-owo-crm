// Next.js вызывает register() один раз при старте сервера.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || !process.env.DATABASE_URL) return;
  const { startNotificationWorker } = await import("./lib/notify/worker");
  startNotificationWorker();
}
