/* FirstPhone Munkaasztal — 📅 beosztás naptár-feliratkozás (Cloudflare Pages Function, ingyenes)
   A Munkaasztal (Beosztás → 📅 Naptárba) dolgozónként elkészíti a műszakok naptárfájlját (.ics) és a bolt saját
   Firestore helyére menti: boltok/{bolt}/cal/{dolgozó} = { t: titkos kulcs, ics, name, n }.
   Ez a végpont csak kiolvassa és naptárként adja tovább — így az iPhone / Google Naptár magától frissül.
     GET /cal/{bolt}/{dolgozó}/{kulcs}.ics  → text/calendar (erre iratkozik fel a naptár)
     GET /cal/{bolt}/{dolgozó}/{kulcs}      → kis oldal két gombbal (iPhone / Google) — ezt nyitja a QR-kód
   A kulcs nélkül (vagy rossz kulccsal) semmit nem ad ki. Ugyanazt a FIREBASE_SA titkot használja, mint az admin végpont. */
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64uStr = s => b64u(new TextEncoder().encode(s));
let tokCache = null;
async function accessToken(sa) {
  if (tokCache && tokCache.exp > Date.now() + 60000) return tokCache.t;
  const now = Math.floor(Date.now() / 1000);
  const head = b64uStr(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const body = b64uStr(JSON.stringify({ iss: sa.client_email, scope: "https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/cloud-platform", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }));
  const pem = sa.private_key.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(head + "." + body));
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=" + head + "." + body + "." + b64u(sig) });
  const j = await r.json(); if (!j.access_token) throw new Error("token: " + (j.error_description || j.error || r.status));
  tokCache = { t: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return tokCache.t;
}
const esc = t => String(t == null ? "" : t).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const txt = (s, st = 200, ttl = 0) => new Response(s, { status: st, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": ttl ? `public, max-age=${ttl}` : "no-store" } });
/* időzítés-biztos összehasonlítás */
const same = (a, b) => { a = String(a || ""); b = String(b || ""); if (!a || a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };

function page(name, ics, web) {
  const g = "https://calendar.google.com/calendar/render?cid=" + encodeURIComponent(web);
  return `<!doctype html><html lang="hu"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>Beosztás a naptáradba</title><style>
:root{color-scheme:dark;}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#111116;color:#f2f2f5;font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;padding:20px;box-sizing:border-box;}
.c{max-width:420px;width:100%;background:#1b1b22;border:1px solid #2c2c36;border-radius:22px;padding:26px 22px;box-shadow:0 20px 50px rgba(0,0,0,.4);}
h1{font-size:22px;margin:6px 0 4px;letter-spacing:-.01em;} p{margin:0 0 18px;color:#a9a9b6;font-size:14.5px;} .ic{font-size:40px;}
a.b{display:flex;align-items:center;gap:12px;padding:15px 16px;border-radius:15px;margin-top:10px;text-decoration:none;color:#fff;font-weight:700;background:#26262f;border:1px solid #34343f;}
a.b small{display:block;font-weight:500;color:#a9a9b6;font-size:12.5px;} a.b i{font-style:normal;font-size:24px;} a.b.p{background:linear-gradient(135deg,#f5b300,#e08a00);color:#1b1404;border:0;} a.b.p small{color:#3a2a05;}
.f{margin-top:18px;font-size:12px;color:#7d7d8a;}
</style></head><body><div class="c"><div class="ic">📅</div><h1>${esc(name || "Beosztás")} — műszakok</h1>
<p>Egyszer kell feliratkozni: utána a naptárad magától frissül, amikor a boltban módosul a beosztás.</p>
<a class="b p" href="${esc(web.replace(/^https:/, "webcal:"))}"><i>🍎</i><span>iPhone / iPad / Mac naptár<small>Feliratkozás → „Feliratkozás” gomb</small></span></a>
<a class="b" href="${esc(g)}"><i>🗓️</i><span>Google Naptár<small>Android, Gmail — „Hozzáadás” gomb</small></span></a>
<a class="b" href="${esc(ics)}"><i>⬇️</i><span>Csak letöltés (.ics)<small>egyszeri, nem frissül magától</small></span></a>
<div class="f">FirstPhone Munkaasztal · teszt</div></div></body></html>`;
}

export async function onRequest({ request, env, params }) {
  if (request.method !== "GET" && request.method !== "HEAD") return txt("GET kell", 405);
  const seg = [].concat(params.p || []);
  if (seg.length !== 3) return txt("Hiányos naptár link.", 404);
  let [uid, emp, tok] = seg; const isIcs = /\.ics$/i.test(tok); tok = tok.replace(/\.ics$/i, "");
  if (!/^[A-Za-z0-9]{6,64}$/.test(uid) || !/^[A-Za-z0-9_-]{2,40}$/.test(emp) || !/^[A-Za-z0-9]{16,64}$/.test(tok)) return txt("Hibás naptár link.", 404);
  let sa; try { sa = JSON.parse(env.FIREBASE_SA || ""); } catch (e) { sa = null; }
  if (!sa || !sa.private_key) return txt("A naptár szolgáltatás nincs beállítva.", 503);
  try {
    const at = await accessToken(sa);
    const url = `https://firestore.googleapis.com/v1/projects/${sa.project_id}/databases/(default)/documents/boltok/${uid}/cal/${emp}?mask.fieldPaths=t&mask.fieldPaths=ics&mask.fieldPaths=name`;
    const r = await fetch(url, { headers: { authorization: "Bearer " + at } });
    if (r.status === 404) return txt("Ez a naptár nem létezik (vagy törölték).", 404);
    if (!r.ok) return txt("A naptár most nem érhető el (" + r.status + ").", 502);
    const f = (await r.json()).fields || {}, S = k => (f[k] && f[k].stringValue) || "";
    if (!same(S("t"), tok)) return txt("Ez a naptár link már nem érvényes.", 404);
    if (isIcs) return new Response(S("ics") || "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//FirstPhone//Munkaasztal//HU\r\nEND:VCALENDAR\r\n", { headers: { "content-type": "text/calendar; charset=utf-8", "content-disposition": `inline; filename="beosztas.ics"`, "cache-control": "private, max-age=300" } });
    const web = new URL(request.url); web.search = ""; web.pathname = web.pathname.replace(/\/?$/, "") + ".ics";
    return new Response(page(S("name"), web.pathname, web.toString()), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" } });
  } catch (e) {
    return txt("Hiba: " + String((e && e.message) || e), 502);
  }
}
