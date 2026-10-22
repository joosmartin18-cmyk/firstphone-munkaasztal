/* FirstPhone Munkaasztal — 🔔 beosztás értesítések (csak a /cal/ oldalakhoz) */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
self.addEventListener("push", e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(d.title || "FirstPhone beosztás", {
    body: d.body || "", icon: "/cal-icon.png", badge: "/cal-icon.png", tag: d.tag || "fp-cal", renotify: true, data: { url: d.url || "/cal/" }
  }));
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const u = (e.notification.data || {}).url || "/cal/";
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(L => {
    for (const c of L) if (c.url.indexOf(u) === 0 && "focus" in c) return c.focus();
    return self.clients.openWindow(u);
  }));
});
