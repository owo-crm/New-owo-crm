import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { expect, it, vi } from "vitest";
it("service worker cannot open a URL outside CRM from a forged push payload", async () => {
  type Event = {
    notification: { close: () => void; data: { url: string } };
    waitUntil: (promise: Promise<unknown>) => void;
  };
  const handlers: Record<string, (event: Event) => void> = {};
  const openWindow = vi.fn().mockResolvedValue(undefined);
  let pending: Promise<unknown> | undefined;
  runInNewContext(readFileSync("public/sw.js", "utf8"), {
    URL,
    self: {
      location: { origin: "https://app.example.com" },
      addEventListener: (name: string, handler: (event: Event) => void) => {
        handlers[name] = handler;
      },
      clients: { matchAll: async () => [], openWindow },
    },
  });
  handlers.notificationclick({
    notification: { close: vi.fn(), data: { url: "https://evil.example/steal" } },
    waitUntil: (promise) => {
      pending = promise;
    },
  });
  await pending;
  expect(openWindow).toHaveBeenCalledWith("https://app.example.com/dzisiaj");
});
