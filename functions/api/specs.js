/* FirstPhone Munkaasztal — 📱 készülék adatok lekérdezése (Cloudflare Pages Function, ingyenes)
   A böngésző nem tud közvetlenül más oldalról adatot olvasni, ezért ez a kis végpont kérdezi le
   a GSMArena nyilvános adatlapját, és tiszta JSON-ként adja vissza.
     GET /api/specs?q=galaxy a57        → találati lista [{ id, name, img }]
     GET /api/specs?id=14379 → az adatlap mezői { name, spec:{ kulcs: érték }, rows:[[csoport, címke, érték]] }
   Az eredményt 3 napig gyorsítótárazza (Cloudflare cache), így a forrást is kíméli. */
const json = (o, s = 200, ttl = 0) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json; charset=utf-8", "cache-control": ttl ? `public, max-age=${ttl}` : "no-store", "access-control-allow-origin": "*" } });
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', "#039": "'", apos: "'", nbsp: " ", deg: "°", times: "×", micro: "µ", "#8482": "™", "#174": "®" };
const dec = s => String(s || "").replace(/&(#x?[0-9a-f]+|[a-z0-9]+);/gi, (m, e) => { const k = e.toLowerCase(); if (ENT[k] != null) return ENT[k]; if (k[0] === "#") { const n = k[1] === "x" ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10); return isFinite(n) ? String.fromCodePoint(n) : m; } return m; });
const txt = h => dec(String(h || "").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "")).replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();

async function get(url, ttl = 259200) {
  for (const host of ["https://www.gsmarena.com/", "https://m.gsmarena.com/"]) {
    const r = await fetch(host + url, { headers: { "user-agent": UA, "accept": "text/html,application/xhtml+xml,application/json", "accept-language": "en-US,en;q=0.8" }, cf: { cacheTtl: ttl, cacheEverything: true } }).catch(() => null);
    if (r && r.ok) { const h = await r.text(); if (h && h.length > 2000 && !/Turnstile check/i.test(h.slice(0, 3000))) return h; }
  }
  throw new Error("A GSMArena most nem válaszolt — próbáld újra pár perc múlva, vagy írd be kézzel.");
}

/* a GSMArena saját keresőjének listája (minden telefon: gyártó, név, becenevek, kép) — 1 napig megőrizzük */
let QS = null, QSat = 0;
async function quick() {
  if (QS && Date.now() - QSat < 6 * 3600e3) return QS;
  const home = await get("", 21600);
  const path = (home.match(/AUTOCOMPLETE_LIST_URL\s*=\s*"([^"]+)"/) || [])[1];
  if (!path) throw new Error("A GSMArena kereső most nem érhető el.");
  const j = JSON.parse(await get(path.replace(/^\//, ""), 86400));
  QS = { makers: j[0] || {}, phones: j[1] || [] }; QSat = Date.now(); return QS;
}
const norm = t => String(t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\+/g, " plus ").replace(/[^a-z0-9]+/g, " ").trim();
async function search(q) {
  const { makers, phones } = await quick();
  /* a bolti terméknévből a fölösleg ki: tárhely, RAM, színek, típuskód, „kártyafüggetlen”, DS… */
  const drop = /^(\d+(gb|tb|g)|gb|tb|ds|dual|sim|duos|kartyafuggetlen|fuggetlen|okostelefon|mobiltelefon|telefon|black|white|blue|green|gray|grey|silver|gold|pink|purple|violet|navy|graphite|fekete|feher|kek|zold|szurke|ezust|arany|lila|rozsaszin|hu|eu|nfc)$/;
  const toks = norm(q).split(" ").filter(t => t && !drop.test(t) && !/^sm\s?[a-z]\d/.test(t) && !/^[a-z]{1,3}\d{3,}[a-z]?$/.test(t));
  if (!toks.length) return [];
  const out = [];
  phones.forEach((p, k) => {
    const mk = makers[p[0]] || "", nm = String(p[2] || ""), hay = " " + norm(mk + " " + nm + " " + (p[3] || "")) + " ", full = norm(mk + " " + nm);
    /* a számot tartalmazó szavaknak (pl. A57, S26, 15) pontosan egyezniük kell — a 4G / 5G csak pluszpont */
    if (toks.some(t => /\d/.test(t) && !/^[2345]g$/.test(t) && !hay.includes(" " + t + " "))) return;
    let sc = 0; toks.forEach(t => { if (hay.includes(" " + t + " ")) sc += 3; else if (hay.includes(" " + t)) sc += 1; });
    if (!sc) return;
    const extra = norm(nm).split(" ").filter(w => w && !toks.includes(w)).length; sc -= extra * 0.3;
    if (full === toks.join(" ") || norm(nm) === toks.join(" ")) sc += 5;
    out.push({ sc, k, id: String(p[1]), name: (mk + " " + nm).trim(), img: p[4] ? "https://fdn2.gsmarena.com/vv/bigpic/" + p[4] : "" });
  });
  const best = Math.max(0, ...out.map(x => x.sc));
  return out.filter(x => x.sc >= Math.max(3, best - 2)).sort((a, b) => b.sc - a.sc || a.k - b.k).slice(0, 12).map(({ id, name, img }) => ({ id, name, img }));
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
    /* ideiglenes: forrás-próba (csak néhány ismert adatlap-oldalra) */
    const pr = u.searchParams.get("probe");
    if (pr) { const pu = new URL(pr); if (!/(^|\.)(devicespecifications\.com|phonearena\.com|kimovil\.com|smartprix\.com|gadgets360\.com|gsmarena\.com|icecat\.biz|samsung\.com|mobilecity|nanoreview\.net|versus\.com|phonedb\.net|91mobiles\.com|techradar\.com|wikipedia\.org)$/.test(pu.hostname)) return json({ ok:false, error:"host" }, 400);
      const r = await fetch(pu.href, { headers: { "user-agent": UA, "accept": "text/html,application/json", "accept-language": "en-US,en;q=0.8" } }); const t = await r.text();
      return json({ ok:true, status:r.status, len:t.length, title:(t.match(/<title[^>]*>([\s\S]*?)<\/title>/i)||[])[1]||"", head:t.slice(0,400).replace(/\s+/g," "), links:(t.match(/href="[^"]{0,140}"/g)||[]).slice(0,80), grep:(u.searchParams.get("g") ? (t.match(new RegExp(".{0,120}" + u.searchParams.get("g").replace(/[^a-z0-9_\-]/gi, "") + ".{0,160}", "gi")) || []).slice(0, 6) : []) }); }
    if (id) {
      if (!/^\d{1,6}$/.test(id)) return json({ ok: false, error: "hibás azonosító" }, 400);
      const s = sheet(await get("phone-" + id + ".php"));
      if (!s.rows.length) return json({ ok: false, error: "Nem találtam adatokat ezen az adatlapon." }, 404);
      return json({ ok: true, id, ...s }, 200, 259200);
    }
    if (q.length < 2) return json({ ok: false, error: "Írj be legalább 2 betűt." }, 400);
    const L = await search(q);
    return json({ ok: true, q, list: L }, 200, 86400);
  } catch (e) {
    return json({ ok: false, error: String((e && e.message) || e) }, 502);
  }
}
