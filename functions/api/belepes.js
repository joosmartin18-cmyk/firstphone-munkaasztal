/* FirstPhone Munkaasztal — belépési oldal (/belepes) segédje: megmondja egy BOLTI fiókról, hogy választott-e már saját jelszót.
   Csak @firstphone.hu boltfiókot néz, csak igen/nem választ ad (jelszót, más adatot nem). Kell hozzá a FIREBASE_SA titok (ugyanaz, mint az admin.js-nél). */
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64uStr = s => b64u(new TextEncoder().encode(s));

let tokCache = null;
async function accessToken(sa) {
  if (tokCache && tokCache.exp > Date.now() + 60000) return tokCache.t;
  const now = Math.floor(Date.now() / 1000);
  const head = b64uStr(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const body = b64uStr(JSON.stringify({ iss: sa.client_email, scope: "https://www.googleapis.com/auth/identitytoolkit https://www.googleapis.com/auth/cloud-platform", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }));
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
async function idt(sa, path, body, method = "POST") {
  const t = await accessToken(sa);
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${sa.project_id}/${path}`, { method, headers: { authorization: "Bearer " + t, "content-type": "application/json" }, body: method === "GET" ? undefined : JSON.stringify(body || {}) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j.error && j.error.message) || ("HTTP " + r.status));
  return j;
}
const attrs = u => { try { return JSON.parse((u && u.customAttributes) || "{}") || {}; } catch (e) { return {}; } };

export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  const list = String(url.searchParams.get("e") || "").toLowerCase().split(",").map(s => s.trim()).filter(e => /^[a-z0-9._-]+@firstphone\.hu$/.test(e)).slice(0, 3);
  if (!list.length) return json({ ok: false, error: "hibás cím" }, 400);
  let sa; try { sa = JSON.parse(env.FIREBASE_SA || ""); } catch (e) { sa = null; }
  if (!sa || !sa.private_key) return json({ ok: false, error: "nosa" }, 503);
  try {
    const j = await idt(sa, "accounts:lookup", { email: list });
    const us = (j.users || []).filter(u => !attrs(u).admin);
    if (!us.length) return json({ ok: true, exists: false, own: false });
    /* ha a bolthoz több cím tartozik, bármelyiken saját jelszó van → már belépett */
    const own = us.some(u => attrs(u).pwOwn === true);
    return json({ ok: true, exists: true, own });
  } catch (e) { return json({ ok: false, error: "hiba" }, 500); }
}
