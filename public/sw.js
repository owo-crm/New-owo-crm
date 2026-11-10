/* No private pages are cached. Payload copy is supplied from messages/pl.json by the sender. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("push", (event) => {
  if (!event.data) return;
  let data;
  try {
    data = event.data.json();
  } catch {
    return;
  }
  if (typeof data.title !== "string") return;
  const url =
    typeof data.url === "string" && /^\/leady\/[0-9a-f-]{36}$/.test(data.url)
      ? data.url
      : "/dzisiaj";
  event.waitUntil(
    self.registration.showNotification(data.title.slice(0, 200), {
      body: typeof data.body === "string" ? data.body.slice(0, 500) : "",
      icon: "/icons/icon-192.png",
      tag: typeof data.tag === "string" ? data.tag : undefined,
      data: { url },
    }),
  );
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = event.notification.data?.url;
  const url = new URL(
    typeof path === "string" && /^\/leady\/[0-9a-f-]{36}$/.test(path) ? path : "/dzisiaj",
    self.location.origin,
  ).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (clients) => {
      const client = clients.find((client) => new URL(client.url).origin === self.location.origin);
      if (client) {
        await client.navigate(url);
        return client.focus();
      }
      return self.clients.openWindow(url);
    }),
  );
});
