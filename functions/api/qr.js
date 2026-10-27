/* FirstPhone Munkaasztal — 📷 QR-belépés a Fotó apphoz (Cloudflare Pages Function)
   A bolt gépén a 📷 Fotók ablak QR-kódja egy rövid, 15 percig érvényes kódot tartalmaz. A telefon ezzel
   jelszó nélkül belép ugyanabba a boltba (Firebase egyedi belépési token), és rögtön fotózhat.
     POST /api/qr { action:"make", u? }    (Authorization: Bearer <a gép Firebase idToken-je>) → { ok, code, exp }
     POST /api/qr { action:"redeem", code }                                                  → { ok, token, t, shop }
   A kódok a Firestore fpqr/{kód} dokumentumában vannak (a böngészők nem olvashatják). Ugyanazt a FIREBASE_SA titkot használja. */
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const enc = new TextEncoder();
const b64u = buf => { const a = new Uint8Array(buf); let s = ""; for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000)); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
const b64uStr = s => b64u(enc.encode(s));
const VALID = 15 * 60 * 1000, MAXUSE = 6;
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
/* Firestore REST */
const fv = v => typeof v === "boolean" ? { booleanValue: v } : typeof v === "number" ? { integerValue: String(Math.round(v)) } : { stringValue: String(v == null ? "" : v) };
const unfv = x => !x ? null : "stringValue" in x ? x.stringValue : "integerValue" in x ? Number(x.integerValue) : "booleanValue" in x ? x.booleanValue : null;
const fsUrl = (sa, p) => `https://firestore.googleapis.com/v1/projects/${sa.project_id}/databases/(default)/documents/${p}`;
async function fsGet(sa, p) {
  const r = await fetch(fsUrl(sa, p), { headers: { authorization: "Bearer " + await accessToken(sa) } });
  if (r.status === 404) return null; if (!r.ok) throw new Error("Firestore " + r.status);
  const j = await r.json(); return { ut: j.updateTime, f: Object.fromEntries(Object.entries(j.fields || {}).map(([k, v]) => [k, unfv(v)])) };
}
async function fsPatch(sa, p, data, pre) {
  const q = Object.keys(data).map(k => "updateMask.fieldPaths=" + encodeURIComponent(k)).concat(pre ? [pre] : []).join("&");
  const r = await fetch(fsUrl(sa, p) + "?" + q, { method: "PATCH", headers: { authorization: "Bearer " + await accessToken(sa), "content-type": "application/json" }, body: JSON.stringify({ fields: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, fv(v)])) }) });
  if (!r.ok) { const e = new Error("Firestore " + r.status); e.status = r.status; throw e; }
}
async function lookup(sa, body) {
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${sa.project_id}/accounts:lookup`, { method: "POST", headers: { authorization: "Bearer " + await accessToken(sa), "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({})); return r.ok ? (j.users || [])[0] || null : null;
}
const attrs = u => { try { return JSON.parse(u.customAttributes || "{}") || {}; } catch (e) { return {}; } };
const isAdm = u => String(u.email || "").toLowerCase() === "admin@admin.com" || attrs(u).admin === true;
const rnd = n => { const b = new Uint8Array(n); crypto.getRandomValues(b); return Array.from(b, x => "abcdefghjkmnpqrstuvwxyz23456789"[x % 31]).join(""); };

export async function onRequest({ request, env }) {
  if (request.method !== "POST") return json({ ok: false, error: "POST kell" }, 405);
  let sa; try { sa = JSON.parse(env.FIREBASE_SA || ""); } catch (e) { sa = null; }
  if (!sa || !sa.private_key || !sa.client_email) return json({ ok: false, error: "nosa" }, 503);
  const q = await request.json().catch(() => ({}));
  try {
    if (q.action === "make") {
      const idToken = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
      if (!idToken) return json({ ok: false, error: "nincs belépve" }, 401);
      const me = await lookup(sa, { idToken });
      if (!me || me.disabled) return json({ ok: false, error: "érvénytelen belépés" }, 401);
      const email = String(me.email || "").toLowerCase();
      if (!/@firstphone\.hu$/.test(email) && !isAdm(me)) return json({ ok: false, error: "csak bolti fiók" }, 403);
      const t = isAdm(me) && /^[A-Za-z0-9]{6,64}$/.test(String(q.u || "")) ? String(q.u) : me.localId;
      const code = rnd(10), exp = Date.now() + VALID;
      await fsPatch(sa, "fpqr/" + code, { uid: me.localId, t, email, exp, n: 0, at: Date.now() }, "currentDocument.exists=false");
      return json({ ok: true, code, exp });
    }
    if (q.action === "redeem") {
      const code = String(q.code || "").toLowerCase();
      if (!/^[a-z0-9]{10}$/.test(code)) return json({ ok: false, error: "hibás kód" }, 400);
      const d = await fsGet(sa, "fpqr/" + code);
      if (!d) return json({ ok: false, error: "Ez a QR-kód nem érvényes. Nyisd meg újra a 📷 Fotókat a gépen, és olvasd be az új kódot." }, 404);
      if (+d.f.exp < Date.now()) return json({ ok: false, error: "Ez a QR-kód lejárt (15 percig érvényes). A gépen a 📷 Fotók ablakban már új kód van — olvasd be azt." }, 410);
      if ((+d.f.n || 0) >= MAXUSE) return json({ ok: false, error: "Ezt a QR-kódot már túl sokszor használták. Olvasd be az újat a gépről." }, 429);
      try { await fsPatch(sa, "fpqr/" + code, { n: (+d.f.n || 0) + 1, last: Date.now() }, "currentDocument.updateTime=" + encodeURIComponent(d.ut)); }
      catch (e) { return json({ ok: false, error: "Próbáld újra." }, 409); }
      const u = await lookup(sa, { localId: [d.f.uid] });
      if (!u || u.disabled) return json({ ok: false, error: "Ez a bolti fiók nem érhető el." }, 403);
      const now = Math.floor(Date.now() / 1000);
      const token = await jwt(sa, { iss: sa.client_email, sub: sa.client_email, aud: "https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit", iat: now, exp: now + 3600, uid: d.f.uid });
      return json({ ok: true, token, t: d.f.t || d.f.uid, email: u.email || "" });
    }
    return json({ ok: false, error: "ismeretlen művelet" }, 400);
  } catch (e) {
    return json({ ok: false, error: String((e && e.message) || e) }, 502);
  }
}
