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
  /* a naptár nyílik meg azon a napon: iPhone-on a saját oldalon át (Naptár app), máshol a Google Naptár */
  const u = (e.notification.data || {}).url || "/cal/";
  e.waitUntil((async () => {
    const same = u.indexOf(self.location.origin) === 0, base = u.split("?")[0];
    if (same) {
      const L = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const c of L) if (c.url.split("?")[0] === base && "navigate" in c) { try { const n = await c.navigate(u); return (n || c).focus(); } catch (_) {} }
    }
    return self.clients.openWindow(u);
  })());
});
