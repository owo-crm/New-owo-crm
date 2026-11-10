import "server-only";
import { runNotifications } from "./runner";
/** Мгновенная отправка после нового лида; если не вышло — фоновый воркер повторит из очереди. */
export async function kickNotifications(leadId: string) {
  try {
    await runNotifications(leadId);
  } catch (error) {
    console.error("[notify] kick", (error as Error).message);
  }
}
