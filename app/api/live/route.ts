import { requireOrganization } from "@/lib/auth/session";
import { leadBus } from "@/lib/db/listen";

// Server-Sent Events: браузер узнаёт о новых/изменённых лидах своей фирмы (вместо Supabase Realtime).
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { organization } = await requireOrganization();
  const bus = leadBus();
  const encoder = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream({
    start(controller) {
      const send = (data: string) => controller.enqueue(encoder.encode(data));
      const onChange = (change: { id: string; op: string }) =>
        send(`data: ${JSON.stringify({ id: change.id, op: change.op })}\n\n`);
      const ping = setInterval(() => send(": ping\n\n"), 25_000);
      bus.on(organization.id, onChange);
      send("retry: 3000\n: connected\n\n");
      cleanup = () => {
        clearInterval(ping);
        bus.off(organization.id, onChange);
      };
      request.signal.addEventListener("abort", () => {
        cleanup();
        try {
          controller.close();
        } catch {}
      });
    },
    cancel: () => cleanup(),
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
