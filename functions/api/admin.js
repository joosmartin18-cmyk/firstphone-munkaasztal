/* FirstPhone Munkaasztal — admin végpont (Cloudflare Pages Function, ingyenes)
   Csak admin használhatja: a fő admin (admin@admin.com) és az általa / más admin által létrehozott
   admin fiókok (Firebase custom claim: admin=true). Boltfiókok listája, új jelszó, letiltás,
   fiók létrehozása, admin fiókok létrehozása (név + e-mail + ideiglenes jelszó).
   Az új admin első belépéskor köteles jelszót cserélni (claim: mustChange=true) — amíg nem cseréli,
   a szerver és a Firestore szabályok sem engednek neki semmit.
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
const attrs = u => { try { return JSON.parse((u && u.customAttributes) || "{}") || {}; } catch (e) { return {}; } };
const isSuper = u => String((u && u.email) || "").toLowerCase() === ADMIN;
const isAdm = u => isSuper(u) || attrs(u).admin === true;
const strongPw = pw => pw.length >= 8 && /[a-zA-Z]/.test(pw) && /[0-9]/.test(pw);
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
    if (!me) return json({ ok: false, error: "érvénytelen belépés" }, 401);
    const q = await request.json().catch(() => ({}));

    /* saját jelszó cseréje (első belépés után kötelező) — bármelyik admin fiók, a saját fiókjára */
    if (q.action === "selfpw") {
      if (!isAdm(me)) return json({ ok: false, error: "csak az admin" }, 403);
      const pw = String(q.password || "");
      if (!strongPw(pw)) return json({ ok: false, error: "A jelszó legalább 8 karakter legyen, betűvel és számmal." }, 400);
      const a = attrs(me); delete a.mustChange;
      await idt(sa, "accounts:update", { localId: me.localId, password: pw, customAttributes: JSON.stringify(a) });
      return json({ ok: true });
    }
    if (!isAdm(me)) return json({ ok: false, error: "csak az admin" }, 403);
    if (attrs(me).mustChange) return json({ ok: false, error: "Előbb cseréld le az ideiglenes jelszavad." }, 403);
    const meEmail = String(me.email || "").toLowerCase();
    const email = String(q.email || "").trim().toLowerCase();
    if (q.action === "list") {
      const users = []; let page = "";
      do { const j = await idt(sa, "accounts:batchGet?maxResults=500" + (page ? "&nextPageToken=" + encodeURIComponent(page) : ""), null, "GET");
        (j.users || []).forEach(u => { const a = attrs(u); users.push({ email: u.email || "", name: u.displayName || "", disabled: !!u.disabled, created: +u.createdAt || 0, last: +u.lastLoginAt || 0, pwAt: +u.passwordUpdatedAt || 0, admin: isAdm(u), sup: isSuper(u), must: !!a.mustChange, by: a.by || "" }); });
        page = j.nextPageToken || ""; } while (page && users.length < 5000);
      return json({ ok: true, users, me: meEmail });
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ ok: false, error: "hibás e-mail" }, 400);
    if (email === ADMIN && (q.action !== "password" || meEmail !== ADMIN)) return json({ ok: false, error: "a fő admin fiókot csak saját maga módosíthatja" }, 403);
    if (email === meEmail && q.action !== "password") return json({ ok: false, error: "a saját fiókodat így nem módosíthatod" }, 400);

    /* új admin fiók: név + e-mail + ideiglenes jelszó; első belépéskor jelszót kell cserélnie */
    if (q.action === "createAdmin") {
      const name = String(q.name || "").trim().slice(0, 60), pw = String(q.password || "");
      if (name.length < 2) return json({ ok: false, error: "add meg a nevét" }, 400);
      if (pw.length < 8) return json({ ok: false, error: "az ideiglenes jelszó legalább 8 karakter legyen" }, 400);
      const ca = JSON.stringify({ admin: true, mustChange: true, by: meEmail });
      const u = await byEmail(sa, email);
      if (u) {
        if (isAdm(u)) return json({ ok: false, error: "ez már admin fiók" }, 409);
        await idt(sa, "accounts:update", { localId: u.localId, displayName: name, password: pw, customAttributes: ca, disableUser: false });
        return json({ ok: true, upgraded: true });
      }
      const c = await idt(sa, "accounts", { email, password: pw, displayName: name, emailVerified: false });
      await idt(sa, "accounts:update", { localId: c.localId, customAttributes: ca });
      return json({ ok: true });
    }
    if (q.action === "revokeAdmin") {
      const u = await byEmail(sa, email); if (!u || !isAdm(u)) return json({ ok: false, error: "nincs ilyen admin fiók" }, 404);
      /* az admin jog elvétele: a jog lekerül, a fiók letiltódik (visszafordítható: újra „admin fiók létrehozása” ugyanazzal az e-maillel) */
      await idt(sa, "accounts:update", { localId: u.localId, customAttributes: "{}", disableUser: true });
      return json({ ok: true });
    }
    if (q.action === "rename") {
      const u = await byEmail(sa, email); if (!u) return json({ ok: false, error: "nincs ilyen fiók" }, 404);
      await idt(sa, "accounts:update", { localId: u.localId, displayName: String(q.name || "").trim().slice(0, 60) });
      return json({ ok: true });
    }
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
      /* másik admin új jelszót kap → az ideiglenes, első belépéskor cserélnie kell */
      if (isAdm(u) && !isSuper(u) && email !== meEmail) { const a = attrs(u); a.mustChange = true; await idt(sa, "accounts:update", { localId: u.localId, password: pw, customAttributes: JSON.stringify(a) }); return json({ ok: true, temp: true }); }
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
