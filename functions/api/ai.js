/* FirstPhone Munkaasztal — 🤖 AI segítség az Eladássegédhez és a tréninghez (Cloudflare Pages Function)
     POST /api/ai  (Authorization: Bearer <Firebase idToken>)
       { task:"card", q, specs? }          → { ok, card }     eladási kártya egy termékre
       { task:"ask",  q, card }            → { ok, text }     kérdés egy termékről (a kártya adataiból)
       { task:"quiz", topic, n, level, card? } → { ok, quiz }  tesztkérdések (4 válaszlehetőség, magyarázattal)
   Kell hozzá: ANTHROPIC_API_KEY titok a Cloudflare Pages beállításaiban (és a már meglévő FIREBASE_SA).
   Napi keret boltonként (AI_DAILY, alapból 300 kérés), hogy véletlenül se fusson el a költség. */
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const enc = new TextEncoder();
const b64u = buf => { const a = new Uint8Array(buf); let s = ""; for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000)); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
const b64uStr = s => b64u(enc.encode(s));
let keyCache = null, tokCache = null;
async function rsaKey(sa) {
  if (keyCache) return keyCache;
  const pem = sa.private_key.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), c => c.charCodeAt(0));
  return (keyCache = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]));
}
async function jwt(sa, payload) {
  const head = b64uStr(JSON.stringify({ alg: "RS256", typ: "JWT" })), body = b64uStr(JSON.stringify(payload));
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", await rsaKey(sa), enc.encode(head + "." + body));
  return head + "." + body + "." + b64u(sig);
}
async function accessToken(sa) {
  if (tokCache && tokCache.exp > Date.now() + 60000) return tokCache.t;
  const now = Math.floor(Date.now() / 1000);
  const a = await jwt(sa, { iss: sa.client_email, scope: "https://www.googleapis.com/auth/identitytoolkit https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/cloud-platform", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 });
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=" + a });
  const j = await r.json(); if (!j.access_token) throw new Error("token: " + (j.error_description || j.error || r.status));
  tokCache = { t: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return tokCache.t;
}
async function lookup(sa, idToken) {
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${sa.project_id}/accounts:lookup`, { method: "POST", headers: { authorization: "Bearer " + await accessToken(sa), "content-type": "application/json" }, body: JSON.stringify({ idToken }) });
  const j = await r.json().catch(() => ({})); return r.ok ? (j.users || [])[0] || null : null;
}
const attrs = u => { try { return JSON.parse(u.customAttributes || "{}") || {}; } catch (e) { return {}; } };
const isAdm = u => String(u.email || "").toLowerCase() === "admin@admin.com" || attrs(u).admin === true;
const fsUrl = (sa, p) => `https://firestore.googleapis.com/v1/projects/${sa.project_id}/databases/(default)/documents/${p}`;
const budaDay = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Budapest", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
/* napi keret: fpai/{uid} = { d:"ÉÉÉÉ-HH-NN", n } */
async function quota(sa, uid, max) {
  const tk = await accessToken(sa), url = fsUrl(sa, "fpai/" + uid), day = budaDay();
  let n = 0; try { const r = await fetch(url, { headers: { authorization: "Bearer " + tk } }); if (r.ok) { const j = await r.json(), f = j.fields || {}; if (f.d && f.d.stringValue === day) n = +((f.n && f.n.integerValue) || 0); } } catch (e) {}
  if (n >= max) return false;
  await fetch(url + "?updateMask.fieldPaths=d&updateMask.fieldPaths=n", { method: "PATCH", headers: { authorization: "Bearer " + tk, "content-type": "application/json" }, body: JSON.stringify({ fields: { d: { stringValue: day }, n: { integerValue: String(n + 1) } } }) }).catch(() => {});
  return true;
}
const clip = (s, n) => String(s == null ? "" : s).slice(0, n);
const SYS = "Egy magyar mobiltelefon- és kiegészítő-üzletlánc (FirstPhone) bolti eladóit segíted. Mindig magyarul, közérthetően, gyakorlatiasan válaszolsz. " +
  "Nem találsz ki árat, akciót, garanciális feltételt vagy konkrét műszaki adatot: csak azt használod, ami a kapott adatokban szerepel, vagy ami általánosan, biztosan igaz. " +
  "Ha valami bizonytalan, azt írod, hogy nézzék meg az adatlapon vagy a Bizzióban. A vásárlónak szánt mondatokat magázva írod.";
async function claude(env, prompt, maxTok) {
  const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: env.AI_MODEL || "claude-sonnet-5", max_tokens: maxTok || 1500, system: SYS, messages: [{ role: "user", content: prompt }] }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error((j.error && j.error.message) || ("AI " + r.status)); e.status = r.status; throw e; }
  return (j.content || []).filter(c => c.type === "text").map(c => c.text).join("").trim();
}
function asJson(t) { try { return JSON.parse(t); } catch (e) {} const a = t.indexOf("{"), b = t.lastIndexOf("}"); if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch (e) {} } return null; }
const arr = (v, n, m) => (Array.isArray(v) ? v : []).slice(0, n).map(x => Array.isArray(x) ? x.slice(0, 2).map(y => clip(y, m)) : clip(x, m)).filter(x => Array.isArray(x) ? x[0] : x);

export async function onRequest({ request, env }) {
  if (request.method !== "POST") return json({ ok: false, error: "POST kell" }, 405);
  if (!env.ANTHROPIC_API_KEY) return json({ ok: false, error: "nokey", msg: "Az AI még nincs bekapcsolva (hiányzik az ANTHROPIC_API_KEY a Cloudflare beállításaiban)." }, 503);
  let sa; try { sa = JSON.parse(env.FIREBASE_SA || ""); } catch (e) { sa = null; }
  if (!sa || !sa.private_key) return json({ ok: false, error: "nosa" }, 503);
  const idToken = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!idToken) return json({ ok: false, error: "Nincs belépve." }, 401);
  const q = await request.json().catch(() => ({}));
  try {
    const me = await lookup(sa, idToken);
    if (!me || me.disabled) return json({ ok: false, error: "Érvénytelen belépés." }, 401);
    if (!/@firstphone\.hu$/i.test(String(me.email || "")) && !isAdm(me)) return json({ ok: false, error: "Csak bolti fiókkal használható." }, 403);
    if (!(await quota(sa, me.localId, +(env.AI_DAILY || 300)))) return json({ ok: false, error: "limit", msg: "Mára elfogyott az AI-keret ennél a boltnál — holnap újra lehet." }, 429);

    if (q.task === "card") {
      const name = clip(q.q, 160).trim(); if (!name) return json({ ok: false, error: "Írd be a termék nevét." }, 400);
      const specs = clip(q.specs, 2500);
      const t = await claude(env, `Írj eladási segédkártyát erről a termékről: "${name}".\n${specs ? "Ismert adatok (a bolt Speckójából):\n" + specs + "\n" : ""}` +
        `Az érveket a vásárló nyelvén írd (ne műszaki zsargonnal), rövid sorokban.\nCSAK egy JSON objektumot adj vissza, pontosan ezekkel a kulcsokkal:\n` +
        `{"name":"pontos terméknév","ic":"egy emoji","cat":"telefon|kiegészítő|tablet|óra|egyéb","who":["3 vásárlótípus"],"ask":["3-4 kérdés a vásárlónak, magázva"],"pros":["3 fő érv"],"obj":[["kifogás","válasz"],["kifogás","válasz"],["kifogás","válasz"]],"cmp":[["hasonló termék","miben más"]],"add":[["kiegészítő","miért ajánld"]],"say":["2 kész mondat, magázva"],"no":["1-2 dolog, amit ne ígérjen"]}`, 1800);
      const c = asJson(t); if (!c) return json({ ok: false, error: "Az AI válasza nem volt értelmezhető — próbáld újra." }, 502);
      const card = { name: clip(c.name || name, 160), ic: clip(c.ic || "📦", 4), cat: clip(c.cat, 20), who: arr(c.who, 4, 160), ask: arr(c.ask, 5, 180), pros: arr(c.pros, 4, 180), obj: arr(c.obj, 4, 260), cmp: arr(c.cmp, 3, 200), add: arr(c.add, 5, 200), say: arr(c.say, 3, 260), no: arr(c.no, 3, 200) };
      return json({ ok: true, card });
    }
    if (q.task === "ask") {
      const qq = clip(q.q, 600).trim(); if (!qq) return json({ ok: false, error: "Írd be a kérdést." }, 400);
      const t = await claude(env, `A termék adatai:\n${clip(JSON.stringify(q.card || {}), 4000)}\n\nAz eladó kérdése (élő vásárló előtt áll): ${qq}\n\nVálaszolj röviden (legfeljebb 8 sor), tegezve az eladót; ha kész mondatot adsz, idézőjelbe tedd.`, 900);
      return json({ ok: true, text: t });
    }
    if (q.task === "quiz") {
      const topic = clip(q.topic, 200).trim(); if (!topic) return json({ ok: false, error: "Add meg a témát vagy a terméket." }, 400);
      const n = Math.max(3, Math.min(12, +q.n || 5)), lvl = { easy: "könnyű, kezdő eladónak", mid: "közepes", hard: "nehéz, tapasztalt eladónak" }[q.level] || "közepes";
      const t = await claude(env, `Készíts ${n} kérdéses feleletválasztós tréningtesztet bolti eladóknak ebben a témában: "${topic}". Nehézség: ${lvl}.\n` +
        `${q.card ? "A termék adatai:\n" + clip(JSON.stringify(q.card), 3000) + "\n" : ""}` +
        `A kérdések az eladási helyzetekről, a vásárló kezeléséről, kifogáskezelésről, kiegészítő-ajánlásról és a termék általánosan igaz tulajdonságairól szóljanak — ne találj ki konkrét számot.\n` +
        `CSAK JSON-t adj vissza: {"title":"rövid cím","questions":[{"q":"kérdés","opts":["A","B","C","D"],"a":0,"why":"1-2 mondatos magyarázat"}]} — "a" a helyes válasz sorszáma (0-3), a helyes válasz helye legyen változatos.`, 3000);
      const z = asJson(t); if (!z || !Array.isArray(z.questions)) return json({ ok: false, error: "Az AI válasza nem volt értelmezhető — próbáld újra." }, 502);
      const qs = z.questions.slice(0, n).map(x => ({ q: clip(x.q, 300), opts: arr(x.opts, 4, 200), a: Math.max(0, Math.min(3, +x.a || 0)), why: clip(x.why, 400) })).filter(x => x.q && x.opts.length >= 2 && x.a < x.opts.length);
      return json({ ok: true, quiz: { title: clip(z.title || topic, 120), questions: qs } });
    }
    return json({ ok: false, error: "ismeretlen feladat" }, 400);
  } catch (e) {
    return json({ ok: false, error: e && e.status === 429 ? "Az AI most túlterhelt — próbáld újra pár perc múlva." : String((e && e.message) || e) }, 502);
  }
}
