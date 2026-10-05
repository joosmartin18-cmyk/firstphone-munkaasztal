/* FirstPhone Munkaasztal — admin végpont (Cloudflare Pages Function, ingyenes)
   Csak az admin@admin.com fiók használhatja: boltfiókok listája, új jelszó beállítása,
   letiltás / engedélyezés, fiók létrehozása.
   Kell hozzá egy titkos környezeti változó a Cloudflare-ben: FIREBASE_SA = a Firebase
   szolgáltatásfiók JSON kulcsa (Project settings → Service accounts → Generate new private key).
   A jelszavakat sehol nem tárolja — a Firebase csak titkosítva (hash) őrzi őket. */
const ADMIN = "admin@admin.com";
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
async function byEmail(sa, email) {
  const j = await idt(sa, "accounts:lookup", { email: [email] });
  return (j.users || [])[0] || null;
}

export async function onRequest({ request, env }) {
  if (request.method !== "POST") return json({ ok: false, error: "POST kell" }, 405);
  let sa; try { sa = JSON.parse(env.FIREBASE_SA || ""); } catch (e) { sa = null; }
  if (!sa || !sa.private_key || !sa.client_email) return json({ ok: false, error: "nosa" }, 503);
  try {
    /* ki hív? — a Firebase belépési token ellenőrzése a Google-nál; csak az admin mehet tovább */
    const idToken = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    if (!idToken) return json({ ok: false, error: "nincs belépve" }, 401);
    let me; try { me = ((await idt(sa, "accounts:lookup", { idToken })).users || [])[0]; } catch (e) { return json({ ok: false, error: "érvénytelen belépés" }, 401); }
    if (!me || String(me.email || "").toLowerCase() !== ADMIN) return json({ ok: false, error: "csak az admin" }, 403);

    const q = await request.json().catch(() => ({}));
    const email = String(q.email || "").trim().toLowerCase();
    if (q.action === "list") {
      const users = []; let page = "";
      do { const j = await idt(sa, "accounts:batchGet?maxResults=500" + (page ? "&nextPageToken=" + encodeURIComponent(page) : ""), null, "GET");
        (j.users || []).forEach(u => users.push({ email: u.email || "", disabled: !!u.disabled, created: +u.createdAt || 0, last: +u.lastLoginAt || 0, pwAt: +u.passwordUpdatedAt || 0 }));
        page = j.nextPageToken || ""; } while (page && users.length < 5000);
      return json({ ok: true, users });
    }
    if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(email)) return json({ ok: false, error: "hibás e-mail" }, 400);
    if (email === ADMIN && q.action !== "password") return json({ ok: false, error: "az admin fiókot így nem lehet módosítani" }, 400);
    if (q.action === "password" || q.action === "create") {
      const pw = String(q.password || "");
      if (pw.length < 6) return json({ ok: false, error: "a jelszó legalább 6 karakter legyen" }, 400);
      const u = await byEmail(sa, email);
      if (q.action === "create") {
        if (u) return json({ ok: false, error: "már létezik" }, 409);
        await idt(sa, "accounts", { email, password: pw, emailVerified: false });
        return json({ ok: true });
      }
      if (!u) return json({ ok: false, error: "nincs ilyen fiók" }, 404);
      await idt(sa, "accounts:update", { localId: u.localId, password: pw });
      return json({ ok: true });
    }
    if (q.action === "disable") {
      const u = await byEmail(sa, email); if (!u) return json({ ok: false, error: "nincs ilyen fiók" }, 404);
      await idt(sa, "accounts:update", { localId: u.localId, disableUser: !!q.disabled });
      return json({ ok: true });
    }
    return json({ ok: false, error: "ismeretlen művelet" }, 400);
  } catch (e) {
    return json({ ok: false, error: String(e && e.message || e) }, 500);
  }
}
