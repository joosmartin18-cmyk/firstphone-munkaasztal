/* FirstPhone Munkaasztal — 📱 készülék adatok lekérdezése (Cloudflare Pages Function, ingyenes)
   A böngésző nem tud közvetlenül más oldalról adatot olvasni, ezért ez a kis végpont kérdezi le
   a GSMArena nyilvános adatlapját, és tiszta JSON-ként adja vissza.
     GET /api/specs?q=galaxy a57        → találati lista [{ id, name, img }]
     GET /api/specs?id=samsung_galaxy_a57-14xxx → az adatlap mezői { name, spec:{ kulcs: érték }, rows:[[csoport, címke, érték]] }
   Az eredményt 3 napig gyorsítótárazza (Cloudflare cache), így a forrást is kíméli. */
const json = (o, s = 200, ttl = 0) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json; charset=utf-8", "cache-control": ttl ? `public, max-age=${ttl}` : "no-store", "access-control-allow-origin": "*" } });
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', "#039": "'", apos: "'", nbsp: " ", deg: "°", times: "×", micro: "µ", "#8482": "™", "#174": "®" };
const dec = s => String(s || "").replace(/&(#x?[0-9a-f]+|[a-z0-9]+);/gi, (m, e) => { const k = e.toLowerCase(); if (ENT[k] != null) return ENT[k]; if (k[0] === "#") { const n = k[1] === "x" ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10); return isFinite(n) ? String.fromCodePoint(n) : m; } return m; });
const txt = h => dec(String(h || "").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "")).replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();

async function get(url) {
  for (const host of ["https://www.gsmarena.com/", "https://m.gsmarena.com/"]) {
    const r = await fetch(host + url, { headers: { "user-agent": UA, "accept": "text/html,application/xhtml+xml", "accept-language": "en-US,en;q=0.8" }, cf: { cacheTtl: 259200, cacheEverything: true } }).catch(() => null);
    if (r && r.ok) { const h = await r.text(); if (h && h.length > 2000) return h; }
  }
  throw new Error("A GSMArena most nem válaszolt — próbáld újra pár perc múlva, vagy írd be kézzel.");
}

function search(h) {
  const out = [], seen = new Set();
  const box = (h.match(/<div class="makers">([\s\S]*?)<\/div>/) || [])[1] || h;
  const re = /<a href="([a-z0-9_\-]+-\d+)\.php"[^>]*>([\s\S]*?)<\/a>/gi; let m;
  while ((m = re.exec(box)) && out.length < 15) {
    const id = m[1]; if (seen.has(id)) continue;
    const name = txt((m[2].match(/<span[^>]*>([\s\S]*?)<\/span>/) || [])[1] || m[2]).replace(/\n/g, " ").trim(); if (!name) continue;
    const img = (m[2].match(/<img[^>]+src="([^"]+)"/) || [])[1] || "";
    seen.add(id); out.push({ id, name, img });
  }
  return out;
}

function sheet(h) {
  const name = txt((h.match(/data-spec="modelname"[^>]*>([\s\S]*?)<\/h1>/) || [])[1] || (h.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [])[1]);
  const spec = {}, rows = [];
  const tbls = h.match(/<table[^>]*cellspacing[\s\S]*?<\/table>/gi) || [];
  tbls.forEach(t => {
    const grp = txt((t.match(/<th[^>]*>([\s\S]*?)<\/th>/) || [])[1]);
    let last = "";
    (t.match(/<tr[\s\S]*?<\/tr>/gi) || []).forEach(tr => {
      const ttl = txt((tr.match(/<td class="ttl"[^>]*>([\s\S]*?)<\/td>/) || [])[1]) || last;
      const nf = tr.match(/<td class="nfo"([^>]*)>([\s\S]*?)<\/td>/); if (!nf) return;
      const key = (nf[1].match(/data-spec="([^"]+)"/) || [])[1] || "";
      const val = txt(nf[2]); if (!val) return;
      last = ttl;
      rows.push([grp, ttl, val]);
      if (key) spec[key] = val;
    });
  });
  const img = (h.match(/<div class="specs-photo-main">[\s\S]*?<img[^>]+src="([^"]+)"/) || [])[1] || "";
  return { name, spec, rows, img };
}

export async function onRequest({ request }) {
  if (request.method === "OPTIONS") return new Response(null, { headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "GET", "access-control-allow-headers": "*" } });
  if (request.method !== "GET") return json({ ok: false, error: "GET kell" }, 405);
  const u = new URL(request.url), q = (u.searchParams.get("q") || "").trim().slice(0, 60), id = (u.searchParams.get("id") || "").trim();
  try {
    if (id) {
      if (!/^[a-z0-9_\-]+-\d+$/i.test(id)) return json({ ok: false, error: "hibás azonosító" }, 400);
      const s = sheet(await get(id + ".php"));
      if (!s.rows.length) return json({ ok: false, error: "Nem találtam adatokat ezen az adatlapon." }, 404);
      return json({ ok: true, id, ...s }, 200, 259200);
    }
    if (q.length < 2) return json({ ok: false, error: "Írj be legalább 2 betűt." }, 400);
    const L = search(await get("results.php3?sQuickSearch=yes&sName=" + encodeURIComponent(q)));
    return json({ ok: true, q, list: L }, 200, 86400);
  } catch (e) {
    return json({ ok: false, error: String((e && e.message) || e) }, 502);
  }
}
