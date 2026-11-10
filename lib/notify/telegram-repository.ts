import { one, type Queryable } from "../db/core.ts";
import type { TelegramRepository } from "./telegram.ts";
export function createTelegramRepository(
  db: Queryable,
  onIngest?: (id: string) => void,
): TelegramRepository {
  return {
    async redeem(hash, chat, user) {
      const row = await one<{ ok: boolean }>(
        db,
        "select public.redeem_telegram_link($1,$2,$3) as ok",
        [hash, chat, user],
      );
      return row?.ok === true;
    },
    async isLinked(chat, user) {
      return Boolean(
        await one(
          db,
          "select 1 from public.telegram_links where chat_id=$1 and telegram_user_id=$2",
          [chat, user],
        ),
      );
    },
    async ingest(chat, user, lead, updateId) {
      const row = await one<{ r: { id: string } }>(
        db,
        "select public.telegram_ingest($1,$2,$3,$4) as r",
        [chat, user, lead, updateId],
      );
      onIngest?.(row!.r.id);
      return row!.r;
    },
    async contact(chat, user, id) {
      const row = await one<{ ok: boolean }>(
        db,
        "select public.telegram_contact_lead($1,$2,$3) as ok",
        [chat, user, id],
      );
      return row?.ok === true;
    },
  };
}
