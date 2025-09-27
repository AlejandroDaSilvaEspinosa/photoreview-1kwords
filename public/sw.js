/* Básico para que showNotification funcione */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
  event.waitUntil(self.clients.claim()),
);

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const allClients = await clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      if (allClients.length > 0) {
        const client = allClients[0];
        client.focus();
        return;
      }
      clients.openWindow("/");
    })(),
  );
});
