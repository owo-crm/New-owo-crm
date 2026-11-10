import "server-only";
import { EventEmitter } from "node:events";
import pg from "pg";

/** Один LISTEN-клиент на процесс: события изменения лидов → подписчики SSE. */
type LeadChange = { organization_id: string; id: string; op: string };
const state = globalThis as typeof globalThis & { __owoLeadBus?: EventEmitter };

export function leadBus() {
  if (state.__owoLeadBus) return state.__owoLeadBus;
  const bus = new EventEmitter();
  bus.setMaxListeners(0);
  state.__owoLeadBus = bus;
  const connect = async () => {
    const client = new pg.Client({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
    });
    client.on("notification", (msg) => {
      try {
        const change = JSON.parse(msg.payload ?? "") as LeadChange;
        bus.emit(change.organization_id, change);
      } catch {}
    });
    client.on("error", () => {
      client.end().catch(() => {});
      bus.emit("__status", false);
      setTimeout(connect, 3000);
    });
    try {
      await client.connect();
      await client.query("listen lead_changes");
      bus.emit("__status", true);
    } catch {
      setTimeout(connect, 3000);
    }
  };
  void connect();
  return bus;
}
