import { websiteHandler } from "@/lib/channels/handlers";

// Публичный приём заявок с сайта: POST /api/intake/<public_key канала>.
export const dynamic = "force-dynamic";

export const POST = (request: Request) => websiteHandler()(request);
export const OPTIONS = POST;
