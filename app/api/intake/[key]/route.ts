import { after } from "next/server";
import { createHmac } from "node:crypto";
import { createIntakeHandler, type WebsiteChannel } from "@/lib/channels/website";
import { createIngestRepository } from "@/lib/leads/repository";
import { getDb, one } from "@/lib/db";
import { kickNotifications } from "@/lib/notify/kick";

// Публичный приём заявок с сайта: POST /api/intake/<public_key канала>.
export const dynamic = "force-dynamic";

function handler() {
  const db = getDb();
  const salt = process.env.INTAKE_IP_SALT;
  if (!salt) throw new Error("Brak INTAKE_IP_SALT");
  return createIntakeHandler({
    repository: (submissionId) => createIngestRepository(db, submissionId),
    clientIp: (req) => req.headers.get("x-real-ip"),
    async findChannel(key) {
      return one<WebsiteChannel>(
        db,
        "select id, organization_id, name, config from public.channels where public_key=$1 and type='website' and status='active'",
        [key],
      );
    },
    async hashIp(ip) {
      return createHmac("sha256", salt).update(ip).digest("hex");
    },
    async reserveAttempt(channel, ipHash) {
      const row = await one<{ r: { id: string; allowed: boolean } }>(
        db,
        "select public.reserve_intake($1,$2,$3) as r",
        [channel.organization_id, channel.id, ipHash],
      );
      return row!.r;
    },
    async finishAttempt(id, ok, error) {
      await db.query("update public.intake_log set ok=$1, error=$2 where id=$3", [ok, error, id]);
    },
    afterIngest: async (result) => kickNotifications(result.id),
    waitUntil: (promise) => after(() => promise),
  });
}

export const POST = (request: Request) => handler()(request);
export const OPTIONS = POST;
