/* FirstPhone Fotó — offline-gyors indulás: az app és a Firebase fájljai a telefonon maradnak (verzió: 20261027-155044) */
const V = "fp-foto-20261027-155044", SDK = "fp-foto-sdk-10.12.2";
const SHELL = ["/scan/", "/scan/manifest.webmanifest", "/scan/icon-180.png", "/scan/icon-192.png"];
const LIBS = ["firebase-app-compat.js", "firebase-auth-compat.js", "firebase-firestore-compat.js"].map(f => "https://www.gstatic.com/firebasejs/10.12.2/" + f);
self.addEventListener("install", e => { self.skipWaiting(); e.waitUntil(Promise.all([
  caches.open(V).then(c => c.addAll(SHELL)).catch(() => {}),
  caches.open(SDK).then(c => Promise.all(LIBS.map(u => c.match(u).then(h => h || fetch(u, { mode: "cors" }).then(r => r.ok && c.put(u, r)))))).catch(() => {})
])); });
self.addEventListener("activate", e => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== V && k !== SDK && k.startsWith("fp-foto")) await caches.delete(k);
  await self.clients.claim();
})()));
self.addEventListener("fetch", e => {
  const r = e.request; if (r.method !== "GET") return;
  const u = new URL(r.url);
  /* Firebase SDK (verziózott, nem változik) → a telefonról */
  if (u.hostname === "www.gstatic.com" && u.pathname.startsWith("/firebasejs/")) {
    e.respondWith(caches.open(SDK).then(c => c.match(r.url).then(h => h || fetch(r).then(n => { if (n.ok) c.put(r.url, n.clone()); return n; }))));
    return;
  }
  if (u.origin !== location.origin || !u.pathname.startsWith("/scan/")) return;
  /* az app: előbb a hálózat (mindig a friss verzió), ha lassú vagy nincs net → ami a telefonon van */
  if (r.mode === "navigate" || u.pathname === "/scan/" || u.pathname === "/scan/index.html") {
    e.respondWith((async () => {
      const c = await caches.open(V), cached = await c.match("/scan/");
      const net = fetch(r, { cache: "no-store" }).then(n => { if (n.ok) c.put("/scan/", n.clone()); return n; });
      if (!cached) return net;
      const t = new Promise(res => setTimeout(() => res(cached), 2500));
      return Promise.race([net.catch(() => cached), t]);
    })());
    return;
  }
  e.respondWith(caches.open(V).then(c => c.match(r).then(h => h || fetch(r).then(n => { if (n.ok) c.put(r, n.clone()); return n; }))));
});
