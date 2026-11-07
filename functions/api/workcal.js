/* FirstPhone Munkaasztal — 📆 hivatalos munkaidő-naptár lekérése egy évre (Cloudflare Pages Function)
     GET /api/workcal?y=2027
   1. hrportal.hu/munkaido-ÉÉÉÉ.html — napra pontos naptár (ünnep, áthelyezett munka- és pihenőnap, havi munkanapok)
   2. ha az nem elérhető: Nemzeti Jogszabálytár — „az ÉÉÉÉ. évi munkaszüneti napok körüli munkarendről” szóló NGM rendelet
   Nyilvános adat, személyes adatot nem kér és nem küld. A választ 12 órára gyorsítótárazza. */
const json = (o, s = 200, cache) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json; charset=utf-8", "cache-control": cache ? "public, max-age=43200" : "no-store", "access-control-allow-origin": "*" } });
const HM = ["január", "február", "március", "április", "május", "június", "július", "augusztus", "szeptember", "október", "november", "december"];
const p2 = n => String(n).padStart(2, "0");
const UA = { "user-agent": "Mozilla/5.0 (compatible; FirstPhone-Munkaasztal/1.0; munkaido-naptar)", "accept-language": "hu-HU,hu;q=0.9" };

/* hrportal: havonta <div class="caltd…">nap</div> cellák; osztály = naptípus */
function parseHr(html, y) {
  const T = { caltdred: "hol", caltdsarga: "rest", caltdszurke: "work", caltd: "day", caltdb: "we" };
  const out = { hol: [], rest: [], work: [], months: [], check: [] };
  const art = html.slice(Math.max(0, html.indexOf(">Január<") - 5));
  const parts = art.split(/>(Január|Február|Március|Április|Május|Június|Július|Augusztus|Szeptember|Október|November|December)</);
  let found = 0;
  for (let i = 1; i < parts.length - 1 && found < 12; i += 2) {
    const m = HM.indexOf(parts[i].toLowerCase()) + 1; if (m !== found + 1) continue;
    const seg = parts[i + 1].split(/munkanap\s+\d+\s+óra/)[0] + (parts[i + 1].match(/(\d+)\s+munkanap\s+(\d+)\s+óra/) || [""])[0];
    const re = /class="(caltd[a-z]*)"\s*>\s*(\d{1,2})\s*</g; let r, nWork = 0, seen = 0;
    while ((r = re.exec(seg))) { const d = +r[2], t = T[r[1]]; if (!t || d < 1 || d > 31) continue; seen++;
      const k = `${y}-${p2(m)}-${p2(d)}`;
      if (t === "hol") out.hol.push(k); else if (t === "rest") out.rest.push(k); else if (t === "work") { out.work.push(k); nWork++; } else if (t === "day") nWork++; }
    const cm = seg.match(/(\d+)\s+munkanap\s+(\d+)\s+óra/);
    if (!seen) return null;
    out.months.push(cm ? +cm[1] : nWork); out.check.push(cm ? +cm[1] === nWork : null); found++;
  }
  return found === 12 ? out : null;
}
/* jogszabály szöveg: „2026. január 10., szombat munkanap” / „… péntek pihenőnap” */
function parseLaw(text, y) {
  const re = new RegExp(`${y}\\.\\s*(${HM.join("|")})\\s*(\\d{1,2})\\.\\s*,?\\s*(hétfő|kedd|szerda|csütörtök|péntek|szombat|vasárnap)\\s*(munkanap|pihenőnap)`, "gi");
  const work = [], rest = [], pairs = []; let r, last = null;
  while ((r = re.exec(text))) { const k = `${y}-${p2(HM.indexOf(r[1].toLowerCase()) + 1)}-${p2(+r[2])}`;
    if (/munkanap/i.test(r[4])) { if (!work.includes(k)) work.push(k); last = k; } else { if (!rest.includes(k)) rest.push(k); if (last) { pairs.push([last, k]); last = null; } } }
  return { work, rest, pairs };
}
const strip = h => h.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&[a-z]+;/g, " ").replace(/\s+/g, " ");
async function get(url) { const r = await fetch(url, { headers: UA, redirect: "follow", cf: { cacheTtl: 3600 } }); if (!r.ok) throw new Error(url + " " + r.status); return r.text(); }

async function fromHr(y) {
  const url = `https://www.hrportal.hu/munkaido-${y}.html`, h = await get(url);
  if (!h.includes("caltd")) return null;
  const c = parseHr(h, y); if (!c) return null;
  return Object.assign(c, { src: "hrportal.hu", url });
}
async function fromNjt(y) {
  /* a következő évi rendelet az előző évben jelenik meg: ÉÉÉÉ-szám-20-2X (NGM rendelet) */
  const want = `${y}. évi munkaszüneti napok`;
  for (let s = 1; s <= 45; s += 15) {
    const urls = Array.from({ length: 15 }, (_, i) => `https://njt.jog.gov.hu/jogszabaly/${y - 1}-${s + i}-20-2X`);
    const res = await Promise.all(urls.map(u => get(u).then(h => ({ u, h })).catch(() => null)));
    const hit = res.find(x => x && x.h.includes(want));
    if (hit) { const L = parseLaw(strip(hit.h), y); if (L.work.length || L.rest.length) return Object.assign(L, { src: "njt.jog.gov.hu", url: hit.u, law: true }); }
  }
  return null;
}
export async function onRequestGet({ request }) {
  const u = new URL(request.url), y = +u.searchParams.get("y") || new Date().getFullYear();
  if (y < 2020 || y > new Date().getFullYear() + 2) return json({ ok: false, error: "year" }, 400);
  const cache = caches.default, ck = new Request(`https://workcal.cache/${y}?v=1`);
  if (!u.searchParams.get("fresh")) { const hit = await cache.match(ck); if (hit) return hit; }
  const errs = [];
  for (const f of [fromHr, fromNjt]) {
    try { const c = await f(y); if (c) { const res = json(Object.assign({ ok: true, y, at: Date.now() }, c), 200, true); await cache.put(ck, res.clone()).catch(() => {}); return res; } }
    catch (e) { errs.push(String(e.message || e).slice(0, 120)); }
  }
  return json({ ok: false, y, error: "notfound", msg: `A ${y}. évi munkaidő-naptár még nem érhető el (valószínűleg még nem jelent meg a rendelet).`, errs });
}
