/* FirstPhone Munkaasztal — 🔁 helyettesítő: egy másik bolt dolgozóinak neve (Cloudflare Pages Function, ingyenes)
   A boltok egymás adatait nem láthatják (Firestore szabály), ezért ez a végpont adja vissza — csak belépett
   Munkaasztal-fióknak, és csak a kért bolt dolgozóinak NEVÉT (semmi mást).
     POST /api/staff  { sid:"KAPT", loc:"Kaposvár", det:"TESCO" }  (Authorization: Bearer <Firebase idToken>)
       → { ok, found, emps:[ "Tóth Evelin Melissza", … ] }
   A nevek a bolt névjegyéből (boltok/{uid}.emps), vagy ha az még nincs, a bolt mentett beosztásából jönnek. */
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const enc = new TextEncoder();
const b64u = buf => { const a = new Uint8Array(buf); let s = ""; for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000)); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
const b64uStr = s => b64u(enc.encode(s));
let tokCache = null;
async function accessToken(sa) {
  if (tokCache && tokCache.exp > Date.now() + 60000) return tokCache.t;
  const now = Math.floor(Date.now() / 1000);
  const head = b64uStr(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const body = b64uStr(JSON.stringify({ iss: sa.client_email, scope: "https://www.googleapis.com/auth/identitytoolkit https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/cloud-platform", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }));
  const pem = sa.private_key.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, enc.encode(head + "." + body));
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=" + head + "." + body + "." + b64u(sig) });
  const j = await r.json(); if (!j.access_token) throw new Error("token: " + (j.error_description || j.error || r.status));
  tokCache = { t: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return tokCache.t;
}
const unfv = x => !x ? null : "stringValue" in x ? x.stringValue : "integerValue" in x ? Number(x.integerValue) : "arrayValue" in x ? (x.arrayValue.values || []).map(unfv) : "booleanValue" in x ? x.booleanValue : null;
const fold = t => String(t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

/* a boltok névjegye — 5 percig megőrizzük */
let META = null, METAat = 0;
async function metas(sa) {
  if (META && Date.now() - METAat < 5 * 60e3) return META;
  const t = await accessToken(sa), out = []; let page = "";
  do {
    const u = `https://firestore.googleapis.com/v1/projects/${sa.project_id}/databases/(default)/documents/boltok?pageSize=300&mask.fieldPaths=sid&mask.fieldPaths=loc&mask.fieldPaths=place&mask.fieldPaths=emps` + (page ? "&pageToken=" + encodeURIComponent(page) : "");
    const r = await fetch(u, { headers: { authorization: "Bearer " + t } }); if (!r.ok) throw new Error("Firestore " + r.status);
    const j = await r.json();
    (j.documents || []).forEach(d => { const f = d.fields || {}; out.push({ uid: d.name.split("/").pop(), sid: unfv(f.sid) || "", loc: unfv(f.loc) || "", place: unfv(f.place) || "", emps: unfv(f.emps) || null }); });
    page = j.nextPageToken || "";
  } while (page);
  META = out; METAat = Date.now(); return out;
}
/* ha a névjegyben még nincs névsor: a bolt mentett beosztásából (egyben mentett állapot esetén) */
async function empsFromState(sa, uid) {
  const t = await accessToken(sa);
  const r = await fetch(`https://firestore.googleapis.com/v1/projects/${sa.project_id}/databases/(default)/documents/boltok/${uid}/kv/firstphone_beosztas_tervezo_v2?mask.fieldPaths=v`, { headers: { authorization: "Bearer " + t } });
  if (!r.ok) return [];
  const f = ((await r.json()).fields || {}), v = unfv(f.v);
  try { const st = JSON.parse(v || "null"); return ((st && st.settings && st.settings.employees) || []).map(e => String(e.name || "").trim()).filter(Boolean); } catch (e) { return []; }
}

export async function onRequest({ request, env }) {
  if (request.method !== "POST") return json({ ok: false, error: "POST kell" }, 405);
  let sa; try { sa = JSON.parse(env.FIREBASE_SA || ""); } catch (e) { sa = null; }
  if (!sa || !sa.private_key) return json({ ok: false, error: "nosa" }, 503);
  try {
    /* csak belépett Munkaasztal-fiók kérdezheti */
    const idToken = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    if (!idToken) return json({ ok: false, error: "nincs belépve" }, 401);
    const at = await accessToken(sa);
    const lr = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${sa.project_id}/accounts:lookup`, { method: "POST", headers: { authorization: "Bearer " + at, "content-type": "application/json" }, body: JSON.stringify({ idToken }) });
    const lj = await lr.json().catch(() => ({})); const me = (lj.users || [])[0];
    if (!lr.ok || !me || me.disabled) return json({ ok: false, error: "érvénytelen belépés" }, 401);
    const q = await request.json().catch(() => ({}));
    const sid = String(q.sid || "").toUpperCase().slice(0, 8), loc = fold(q.loc).slice(0, 40), det = fold(q.det).slice(0, 40);
    if (!sid && !loc) return json({ ok: false, error: "melyik bolt?" }, 400);
    const M = await metas(sa);
    let hit = sid ? M.find(x => x.sid && x.sid.toUpperCase() === sid) : null;
    if (!hit && loc) { const L = M.filter(x => fold(x.loc) === loc); hit = L.find(x => det && fold(x.place).includes(det)) || (L.length === 1 ? L[0] : L.find(x => !det)); }
    if (!hit) return json({ ok: true, found: false, emps: [] });
    let emps = Array.isArray(hit.emps) ? hit.emps : null;
    if (!emps || !emps.length) emps = await empsFromState(sa, hit.uid);
    emps = Array.from(new Set(emps.map(n => String(n || "").trim()).filter(Boolean))).slice(0, 40).sort((a, b) => a.localeCompare(b, "hu"));
    return json({ ok: true, found: true, emps });
  } catch (e) {
    return json({ ok: false, error: String((e && e.message) || e) }, 502);
  }
}
