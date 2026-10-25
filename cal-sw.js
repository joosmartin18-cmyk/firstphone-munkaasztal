/* FirstPhone Munkaasztal — 🔔 beosztás értesítések (csak a /cal/ oldalakhoz) */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
self.addEventListener("push", e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { body: e.data ? e.data.text() : "" }; }
  const o = { body: d.body || "", icon: "/cal-icon.png", badge: "/cal-icon.png", tag: d.tag || "fp-cal", renotify: true, data: { url: d.url || "/cal/", act: d.act || "", d: d.d || "", k: d.k || "" } };
  /* ⏰ határidő: „✓ Elküldtem” gomb (ahol a telefon tud gombot) · a 3. jelzés sürgős: nem tűnik el magától, erősebben rezeg */
  if (d.act) {
    o.actions = [{ action: "done", title: "✓ Elküldtem" }, { action: "later", title: d.urgent ? "Most küldöm" : "Még nem" }];
    if (d.urgent) { o.requireInteraction = true; o.vibrate = [400, 150, 400, 150, 700]; } else o.vibrate = [200, 100, 200];
  }
  e.waitUntil(self.registration.showNotification(d.title || "FirstPhone beosztás", o));
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const D = e.notification.data || {};
  /* ✓ Elküldtem — közvetlenül az értesítésről (többet nem kérdez) */
  if (e.action === "done" && D.act) {
    e.waitUntil(fetch(D.act, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ d: D.d, k: D.k, src: "push" }) })
      .then(r => r.json()).then(j => self.registration.showNotification(j.ok ? "✓ Köszi! Feljegyeztem." : "⚠ Nem sikerült menteni",
        { body: j.ok ? "Ma erről többet nem kérdezlek." : "Nyisd meg az oldaladat, és ott nyomd meg: ✓ Igen, elküldtem.", icon: "/cal-icon.png", badge: "/cal-icon.png", tag: "fp-duty-ok", data: { url: D.url || "/cal/" } }))
      .catch(() => self.registration.showNotification("⚠ Nincs internet", { body: "Nyisd meg később az oldaladat, és ott nyomd meg: ✓ Igen, elküldtem.", icon: "/cal-icon.png", tag: "fp-duty-ok", data: { url: D.url || "/cal/" } })));
    return;
  }
  if (e.action === "later") return;
  /* a naptár nyílik meg azon a napon: iPhone-on a saját oldalon át (Naptár app), máshol a Google Naptár */
  const u = D.url || "/cal/";
  e.waitUntil((async () => {
    const same = u.indexOf(self.location.origin) === 0, base = u.split("?")[0];
    if (same) {
      const L = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const c of L) if (c.url.split("?")[0] === base && "navigate" in c) { try { const n = await c.navigate(u); return (n || c).focus(); } catch (_) {} }
    }
    return self.clients.openWindow(u);
  })());
});
