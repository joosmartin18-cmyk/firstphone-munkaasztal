/* FirstPhone Munkaasztal — 📅 beosztás a dolgozók saját naptárában + 🔔 értesítés (Cloudflare Pages Function, ingyenes)
   A Munkaasztal (Beosztás → 📅 Naptárba) dolgozónként elkészíti a műszakok naptárfájlját (.ics) és a bolt saját
   Firestore helyére menti: boltok/{bolt}/cal/{dolgozó} = { t: titkos kulcs, ics, ev, name, … }.
     GET  /cal/{bolt}/{dolgozó}/{kulcs}.ics          → text/calendar (erre iratkozik fel a naptár) — és felismeri,
                                                       hogy iPhone / Google / Outlook naptár kérte-e (= feliratkozott)
     GET  /cal/{bolt}/{dolgozó}/{kulcs}              → kis oldal: következő műszakok, iPhone / Google gomb, 🔔 értesítés
     GET  /cal/{bolt}/{dolgozó}/{kulcs}/manifest     → a főképernyőre tett „app” leírója (iPhone-on így kap értesítést)
     POST /cal/{bolt}/{dolgozó}/{kulcs}/push         → a telefon értesítési címének mentése / törlése
     POST /cal/{bolt}/{dolgozó}/{kulcs}/notify       → értesítés küldése (a Munkaasztal hívja, ha új hónap jön vagy változik)
     POST /cal/{bolt}/{dolgozó}/{kulcs}/done         → ⏰ „✓ Elküldtem” — a mai határidő (beosztás / jelenléti / zárások) kész
     POST /cal/_tick  { uid? }                       → ⏰ határidő-emlékeztetők kiküldése (napi 3×, a 3. sürgős) — többször hívható
   A kulcs nélkül (vagy rossz kulccsal) semmit nem ad ki. A web push saját kulcspárja (VAPID) első használatkor
   készül, és a Firestore-ban marad (fpsys/vapid) — a böngészők nem olvashatják. Ugyanazt a FIREBASE_SA titkot használja. */
const enc = new TextEncoder();
const b64u = buf => { const a = new Uint8Array(buf); let s = ""; for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000)); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
const b64uStr = s => b64u(enc.encode(s));
const unb64u = s => { s = String(s || "").replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; return Uint8Array.from(atob(s), c => c.charCodeAt(0)); };
const cat = (...a) => { const n = a.reduce((x, y) => x + y.length, 0), o = new Uint8Array(n); let p = 0; a.forEach(x => { o.set(x, p); p += x.length; }); return o; };

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

/* ---- Firestore REST (a szolgáltatásfiókkal) ---- */
const fv = v => v === null || v === undefined ? { nullValue: null } : typeof v === "boolean" ? { booleanValue: v } : typeof v === "number" ? (Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v })
  : v instanceof Date ? { timestampValue: v.toISOString() } : Array.isArray(v) ? { arrayValue: v.length ? { values: v.map(fv) } : {} } : { stringValue: String(v) };
const unfv = x => !x ? null : "stringValue" in x ? x.stringValue : "integerValue" in x ? Number(x.integerValue) : "doubleValue" in x ? x.doubleValue : "booleanValue" in x ? x.booleanValue
  : "timestampValue" in x ? x.timestampValue : "arrayValue" in x ? (x.arrayValue.values || []).map(unfv) : "mapValue" in x ? Object.fromEntries(Object.entries(x.mapValue.fields || {}).map(([k, v]) => [k, unfv(v)])) : null;
function fsBase(sa) { return `https://firestore.googleapis.com/v1/projects/${sa.project_id}/databases/(default)/documents/`; }
async function fsGet(sa, path, fields) {
  const q = (fields || []).map(f => "mask.fieldPaths=" + encodeURIComponent(f)).join("&");
  const r = await fetch(fsBase(sa) + path + (q ? "?" + q : ""), { headers: { authorization: "Bearer " + await accessToken(sa) } });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error("Firestore " + r.status);
  const f = (await r.json()).fields || {}; return Object.fromEntries(Object.entries(f).map(([k, v]) => [k, unfv(v)]));
}
async function fsPatch(sa, path, data, opt) {
  const q = Object.keys(data).map(k => "updateMask.fieldPaths=" + encodeURIComponent(k)).concat(opt && opt.create ? ["currentDocument.exists=false"] : []).concat(opt && opt.ut ? ["currentDocument.updateTime=" + encodeURIComponent(opt.ut)] : []).join("&");
  const r = await fetch(fsBase(sa) + path + "?" + q, { method: "PATCH", headers: { authorization: "Bearer " + await accessToken(sa), "content-type": "application/json" },
    body: JSON.stringify({ fields: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, fv(v)])) }) });
  if (!r.ok) { const e = new Error("Firestore " + r.status); e.status = r.status; throw e; }
  return true;
}

/* ---- 🔔 Web push (RFC 8291 + VAPID RFC 8292) — csak WebCrypto, külső csomag nélkül ---- */
let vapidCache = null;
async function vapid(sa) {
  if (vapidCache) return vapidCache;
  let d = await fsGet(sa, "fpsys/vapid", ["pub", "jwk"]);
  if (!d || !d.pub || !d.jwk) {
    const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const pub = b64u(await crypto.subtle.exportKey("raw", kp.publicKey)), jwk = JSON.stringify(await crypto.subtle.exportKey("jwk", kp.privateKey));
    try { await fsPatch(sa, "fpsys/vapid", { pub, jwk, at: new Date() }, { create: true }); d = { pub, jwk }; }
    catch (e) { d = await fsGet(sa, "fpsys/vapid", ["pub", "jwk"]); if (!d || !d.pub) throw e; } /* közben egy másik kérés már létrehozta */
  }
  vapidCache = { pub: d.pub, key: await crypto.subtle.importKey("jwk", JSON.parse(d.jwk), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]) };
  return vapidCache;
}
async function hkdf(salt, ikm, info, len) {
  const k = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, k, len * 8));
}
/* a tartalom titkosítása a telefon kulcsaival (aes128gcm) */
async function wpEncrypt(payload, p256dh, auth) {
  const ua = unb64u(p256dh), as = unb64u(auth);
  const uaKey = await crypto.subtle.importKey("raw", ua, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const eph = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPub = new Uint8Array(await crypto.subtle.exportKey("raw", eph.publicKey));
  const secret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, eph.privateKey, 256));
  const ikm = await hkdf(as, secret, cat(enc.encode("WebPush: info\0"), ua, asPub), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, cat(enc.encode(payload), new Uint8Array([2]))));
  const rs = new Uint8Array([0, 0, 16, 0]);
  return cat(salt, rs, new Uint8Array([asPub.length]), asPub, ct);
}
async function wpSend(sa, sub, payload, origin, hd) {
  const v = await vapid(sa), u = new URL(sub.endpoint), now = Math.floor(Date.now() / 1000);
  const h = b64uStr(JSON.stringify({ typ: "JWT", alg: "ES256" })) + "." + b64uStr(JSON.stringify({ aud: u.origin, exp: now + 50 * 60, sub: origin }));
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, v.key, enc.encode(h));
  const body = await wpEncrypt(payload, sub.keys.p256dh, sub.keys.auth);
  const r = await fetch(sub.endpoint, { method: "POST", headers: { authorization: `vapid t=${h}.${b64u(sig)}, k=${v.pub}`, "content-encoding": "aes128gcm", "content-type": "application/octet-stream", ttl: String((hd && hd.ttl) || 86400), urgency: (hd && hd.urgency) || "normal" }, body });
  return r.status;
}

/* ---- 🔁 helyettesítés másik boltban (boltok/{otthoni bolt}/away/{ahol helyettesít}) ---- */
async function fsList(sa, path, fields) {
  const q = (fields || []).map(f => "mask.fieldPaths=" + encodeURIComponent(f)).join("&"), out = []; let page = "";
  do { const r = await fetch(fsBase(sa) + path + "?pageSize=300" + (q ? "&" + q : "") + (page ? "&pageToken=" + encodeURIComponent(page) : ""), { headers: { authorization: "Bearer " + await accessToken(sa) } });
    if (!r.ok) break; const j = await r.json();
    (j.documents || []).forEach(doc => out.push(Object.assign({ id: doc.name.split("/").pop() }, Object.fromEntries(Object.entries(doc.fields || {}).map(([k, v]) => [k, unfv(v)])))));
    page = j.nextPageToken || ""; } while (page);
  return out;
}
async function fsDel(sa, path) { await fetch(fsBase(sa) + path, { method: "DELETE", headers: { authorization: "Bearer " + await accessToken(sa) } }).catch(() => {}); }
const foldN = t => String(t || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
const parseL = v => { try { const a = JSON.parse(v || "[]"); return Array.isArray(a) ? a : []; } catch (e) { return []; } };
/* név-egyezés: pontosan, vagy ha csak részben (pl. „Norbert” / „Hack Norbi”), akkor az egyetlen dolgozó, akire illik */
function whoMatch(n, names) { const f = foldN(n); const ex = names.find(x => foldN(x) === f); if (ex) return ex;
  const T = f.split(/\s+/).filter(w => w.length >= 3); if (!T.length) return null;
  const C = names.filter(nm => { const W = foldN(nm).split(/\s+/); return T.every(t => W.some(w => w.startsWith(t) || t.startsWith(w) || (t.length >= 4 && w.length >= 4 && t.slice(0, 4) === w.slice(0, 4)))); });
  return C.length === 1 ? C[0] : null; }
async function awayOf(sa, uid, name) {
  const n = foldN(name), out = [];
  const meta = await fsGet(sa, `boltok/${uid}`, ["emps"]).catch(() => null), names = (meta && Array.isArray(meta.emps) && meta.emps.length) ? meta.emps : [name];
  (await fsList(sa, `boltok/${uid}/away`, ["src", "sid", "addr", "list"])).forEach(doc => { if (doc.id === "_out") return;
    parseL(doc.list).forEach(x => { if (x && /^\d{4}-\d{2}-\d{2}$/.test(String(x.d || "")) && foldN(whoMatch(x.n, names) || "") === n) out.push({ d: x.d, p: x.p || "full", ts: x.ts || "", te: x.te || "", at: doc.src || "másik bolt", sid: doc.sid || "", addr: doc.addr || "" }); }); });
  return out.sort((a, b) => a.d.localeCompare(b.d));
}
const icsE = t => String(t == null ? "" : t).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
function icsFold(l) { const out = []; let cur = "", n = 0; for (const ch of l) { const b = enc.encode(ch).length; if (n + b > 73) { out.push(cur); cur = " "; n = 1; } cur += ch; n += b; } out.push(cur); return out.join("\r\n"); }
const PARTN = { full: "egész nap", am: "délelőtt", pm: "délután" };
function awayIcs(A, emp) {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z"), L = [];
  const hm = t => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || "")); return m ? m[1].padStart(2, "0") + m[2] + "00" : null; };
  A.forEach(x => { const d = x.d.replace(/-/g, ""), s = hm(x.ts), e = hm(x.te), aw = "FirstPhone " + x.at;
    const nd = new Date(Date.UTC(+x.d.slice(0, 4), +x.d.slice(5, 7) - 1, +x.d.slice(8, 10) + 1)).toISOString().slice(0, 10).replace(/-/g, "");
    L.push("BEGIN:VEVENT", `UID:fp-${x.d}-${emp}-hely@firstphone-munkaasztal`, "DTSTAMP:" + stamp,
      ...(s && e ? [`DTSTART;TZID=Europe/Budapest:${d}T${s}`, `DTEND;TZID=Europe/Budapest:${d}T${e}`] : [`DTSTART;VALUE=DATE:${d}`, `DTEND;VALUE=DATE:${nd}`]),
      "SUMMARY:" + icsE("🔁 Helyettesítés · " + x.at), "LOCATION:" + icsE(x.addr ? aw + ", " + x.addr : aw),
      "DESCRIPTION:" + icsE((x.ts ? `${x.ts}–${x.te} · ` : "") + `${PARTN[x.p] || ""}\nHelyettesítés: ${aw}${x.sid ? " (" + x.sid + ")" : ""}\n\nA beosztás változásakor magától frissül.`),
      "TRANSP:OPAQUE", "STATUS:CONFIRMED", "END:VEVENT"); });
  return L.map(icsFold).join("\r\n");
}
const VTZ = ["BEGIN:VTIMEZONE", "TZID:Europe/Budapest", "BEGIN:DAYLIGHT", "TZOFFSETFROM:+0100", "TZOFFSETTO:+0200", "TZNAME:CEST", "DTSTART:19700329T020000", "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU", "END:DAYLIGHT",
  "BEGIN:STANDARD", "TZOFFSETFROM:+0200", "TZOFFSETTO:+0100", "TZNAME:CET", "DTSTART:19701025T030000", "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU", "END:STANDARD", "END:VTIMEZONE"].join("\r\n");
/* értesítés egy dolgozó telefonjaira (iPhone → a saját oldalán át a Naptár app, máshol → Google Naptár, azon a napon) */
async function pushTo(sa, path, doc, base, origin, title, body, day, tag, ex) {
  const L = (doc.push || []).map(x => { try { return JSON.parse(x); } catch (e) { return null; } }).filter(Boolean);
  if (!L.length) return { sent: 0, subs: 0, codes: [] };
  day = /^\d{4}-\d{2}-\d{2}$/.test(String(day || "")) ? day : budaToday(); const [yy, mm, dd] = day.split("-").map(Number);
  const subs = String(doc.subAll || doc.sub || "").split(","), gUrl = `https://calendar.google.com/calendar/r/day/${yy}/${mm}/${dd}`, aUrl = `${base}?open=cal&d=${day}`;
  const res = await Promise.all(L.map(s => { const apple = /push\.apple\.com/i.test(s.endpoint), go = apple ? aUrl : (subs.includes("google") || !subs.includes("apple") ? gUrl : aUrl);
    if (ex) return wpSend(sa, s, JSON.stringify({ title, body, url: ex.url || go, tag, urgent: ex.urgent ? 1 : 0, act: ex.act || "", d: ex.d || "", k: ex.k || "", step: ex.step || 0 }), origin,
      { urgency: ex.urgent ? "high" : "normal", ttl: 6 * 3600 }).catch(() => 0);
    return wpSend(sa, s, JSON.stringify({ title, body, url: go, tag }), origin).catch(() => 0); }));
  const keep = L.filter((s, i) => res[i] !== 404 && res[i] !== 410);
  if (keep.length !== L.length) await fsPatch(sa, path, { push: keep.map(x => JSON.stringify(x)), pushN: keep.length }).catch(() => {});
  return { sent: res.filter(c => c >= 200 && c < 300).length, subs: keep.length, codes: res };
}
const HU_MA = ["jan.", "febr.", "márc.", "ápr.", "máj.", "jún.", "júl.", "aug.", "szept.", "okt.", "nov.", "dec."], HU_DA = ["v", "h", "k", "sze", "cs", "p", "szo"];
const fdHu = k => { const [y, m, d] = k.split("-").map(Number); return `${HU_MA[m - 1]} ${d}. (${HU_DA[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]})`; };
/* ---- ⏰ határidő-emlékeztetők (beosztás / jelenléti ív / zárások elküldése) ----
   A bolt Munkaasztala a határidők napjait a boltok/{bolt}/cal/_duty dokumentumba írja (dl: „nap|kulcs|ikon|mi|mit”).
   Határidő-napon aki aznap dolgozik és kért 🔔 értesítést, napi 3× kap jelzést a saját műszakján belül
   (kezdés +30 perc · a műszak közepe · vége előtt 1,5 órával — ez a 3. már 🔴 sürgős). Ha bárki jelzi, hogy
   elküldte (✓ Elküldtem — az értesítésen, a saját oldalán vagy a boltban), többször nem kérdezi.
   Ki indítja: a bolt nyitott Munkaasztala (pár percenként), a dolgozó oldala, és ha van, egy időzített hívás. */
async function fsGetRaw(sa, path, fields) {
  const q = (fields || []).map(f => "mask.fieldPaths=" + encodeURIComponent(f)).join("&");
  const r = await fetch(fsBase(sa) + path + (q ? "?" + q : ""), { headers: { authorization: "Bearer " + await accessToken(sa) } });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error("Firestore " + r.status);
  const j = await r.json(), f = j.fields || {};
  return { ut: j.updateTime, f: Object.fromEntries(Object.entries(f).map(([k, v]) => [k, unfv(v)])) };
}
const budaMin = () => { const p = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Budapest", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
  const g = t => +((p.find(x => x.type === t) || {}).value || 0); return g("hour") * 60 + g("minute"); };
const hmMin = t => { const m = /(\d{1,2}):(\d{2})/.exec(String(t || "")); return m ? +m[1] * 60 + +m[2] : null; };
/* a 3 jelzés ideje (percben, éjféltől) a dolgozó aznapi műszakjához igazítva */
function dutySlots(ts, te) {
  let s = hmMin(ts), e = hmMin(te); if (s == null || e == null || e <= s) { s = 9 * 60; e = 19 * 60; }
  const a = s + 30, c = Math.max(e - 90, a + 90), b = Math.round((a + c) / 2);
  return [a, b, c];
}
const parseO = v => { try { const o = JSON.parse(v || "{}"); return o && typeof o === "object" && !Array.isArray(o) ? o : {}; } catch (e) { return {}; } };
const dutyLines = dl => String(dl || "").split("\n").map(l => l.split("|")).filter(x => /^\d{4}-\d{2}-\d{2}$/.test(x[0] || "") && /^[a-z]{2,8}$/.test(x[1] || ""));
/* a régi (7 napnál régebbi) bejegyzések törlése, hogy ne nőjön a dokumentum */
function dutyPrune(st, today) { const lim = new Date(Date.parse(today + "T00:00:00Z") - 7 * 864e5).toISOString().slice(0, 10);
  Object.keys(st).forEach(k => { if (k.slice(0, 10) < lim) delete st[k]; }); return st; }
function dutyMsg(step, ic, t, x) {
  const what = String(x || t || "").trim();
  if (step >= 3) return { title: `🔴 SÜRGŐS: ${t} — még nincs elküldve!`, body: `Ma a határidő, és még senki nem jelezte, hogy elküldte ${what}. Kérlek, küldd el MOST! Utána nyomd meg: ✓ Elküldtem.`, urgent: true };
  if (step === 2) return { title: `❓ Elküldted már? ${ic} ${t}`, body: `Ma van a határidő (${what}). Ha már elküldted, nyomd meg: ✓ Elküldtem — és többet nem kérdezem.` };
  return { title: `${ic} Ma kell elküldeni: ${t}`, body: `Ma te dolgozol — ne felejtsd el elküldeni ${what}! Ha megvan, nyomd meg: ✓ Elküldtem. (Napközben még 2× rákérdezek.)` };
}
async function dutyTick(sa, uid, origin, opt) {
  opt = opt || {};
  const path = `boltok/${uid}/cal/_duty`, raw = await fsGetRaw(sa, path, ["dl", "st", "off"]);
  if (!raw || raw.f.off) return { uid, skip: raw ? "off" : "none" };
  const today = budaToday(), nm = budaMin(), now = Date.now();
  const items = dutyLines(raw.f.dl).filter(x => x[0] === today);
  if (!items.length) return { uid, n: 0 };
  const st = parseO(raw.f.st), open = items.filter(([d, k]) => !(st[d + "|" + k] || {}).done);
  if (!open.length) return { uid, n: 0, done: true };
  if (!opt.force && open.every(([d, k]) => +((st[d + "|" + k] || {}).nx || 0) > now)) return { uid, n: 0, wait: true };
  const docs = await fsList(sa, `boltok/${uid}/cal`, ["name", "t", "ev", "push", "sub", "subAll"]);
  const work = docs.filter(x => !String(x.id).startsWith("_") && x.t && (x.push || []).length).map(x => {
    const L = String(x.ev || "").split("\n").map(l => l.split("|")).filter(a => a[0] === today && !a[5]);
    return L.length ? { x, ts: L.map(a => a[1]).sort()[0], te: L.map(a => a[2]).sort().pop() } : null; }).filter(Boolean);
  const out = [];
  for (const [d, k, ic, t, xx] of open) {
    const key = d + "|" + k, S = st[key] = Object.assign({ n: {} }, st[key] || {}); S.n = S.n || {};
    let nx = Infinity;
    for (const w of work) {
      const sl = dutySlots(w.ts, w.te), due = sl.filter(m => m <= nm).length, have = +S.n[w.x.id] || 0;
      if (due > have) { S.n[w.x.id] = due; out.push({ w, d, k, step: due, m: dutyMsg(due, ic || "📤", t || "Elküldés", xx) }); }
      const nxt = sl.find(m => m > nm); if (nxt != null) nx = Math.min(nx, nxt);
    }
    S.nx = nx === Infinity ? now + 6 * 3600e3 : now + (nx - nm) * 60000 - 30000;
  }
  /* előbb lefoglaljuk (ha közben egy másik hívás már elküldte, a Firestore elutasítja → itt nem küldünk újra) */
  try { await fsPatch(sa, path, { st: JSON.stringify(dutyPrune(st, today)) }, { ut: raw.ut }); } catch (e) { return { uid, n: 0, race: true }; }
  let sent = 0;
  for (const o of out) {
    const base = `${origin}/cal/${uid}/${o.w.x.id}/${o.w.x.t}`;
    const r = await pushTo(sa, `boltok/${uid}/cal/${o.w.x.id}`, o.w.x, base, origin, o.m.title, o.m.body, o.d, "fp-duty-" + o.d + "-" + o.k,
      { url: `${base}?duty=${encodeURIComponent(o.d + "|" + o.k)}`, urgent: !!o.m.urgent, act: base + "/done", d: o.d, k: o.k, step: o.step }).catch(() => ({ sent: 0 }));
    sent += r.sent || 0;
  }
  return { uid, n: out.length, sent };
}
/* ✓ Elküldtem — a dolgozó (értesítésről / saját oldaláról) */
async function dutyDone(sa, uid, d, k, who, src, undo) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(d || "")) || !/^[a-z]{2,8}$/.test(String(k || ""))) return { ok: false, error: "hibás" };
  const path = `boltok/${uid}/cal/_duty`;
  for (let i = 0; i < 4; i++) {
    const raw = await fsGetRaw(sa, path, ["st"]), st = parseO(raw && raw.f.st), key = d + "|" + k;
    const S = st[key] = Object.assign({ n: {} }, st[key] || {});
    if (S.done && !undo) return { ok: true, by: S.done, already: true };
    if (undo) { delete S.done; delete S.at; delete S.src; S.nx = 0; } else { S.done = String(who || "valaki").slice(0, 60); S.at = Date.now(); S.src = src || "tel"; }
    try { await fsPatch(sa, path, { st: JSON.stringify(dutyPrune(st, budaToday())) }, raw ? { ut: raw.ut } : { create: true }); return { ok: true, by: S.done || "" }; }
    catch (e) { await new Promise(r => setTimeout(r, 150 + 200 * i)); }
  }
  return { ok: false, error: "ütközés — próbáld újra" };
}
/* a dolgozó oldalán: a mai határidők (ha ma dolgozik, vagy az értesítésből jött) */
async function dutyFor(sa, uid, ev) {
  const raw = await fsGetRaw(sa, `boltok/${uid}/cal/_duty`, ["dl", "st", "off"]).catch(() => null);
  if (!raw || raw.f.off) return [];
  const today = budaToday(), st = parseO(raw.f.st);
  const works = String(ev || "").split("\n").some(l => { const a = l.split("|"); return a[0] === today && !a[5]; });
  return dutyLines(raw.f.dl).filter(x => x[0] === today).map(([d, k, ic, t, x]) => { const S = st[d + "|" + k] || {}; return { d, k, ic: ic || "📤", t: t || "", x: x || "", done: S.done || "", at: S.at || 0, works }; });
}
/* POST /cal/_out — a hívó bolt „másik boltból jött” helyettesítői → a saját boltjuk megkapja (+ 🔔 a dolgozónak) */
async function handleOut(request, sa, origin) {
  const idToken = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!idToken) return json({ ok: false, error: "nincs belépve" }, 401);
  const lr = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${sa.project_id}/accounts:lookup`, { method: "POST", headers: { authorization: "Bearer " + await accessToken(sa), "content-type": "application/json" }, body: JSON.stringify({ idToken }) });
  const me = ((await lr.json().catch(() => ({}))).users || [])[0];
  if (!lr.ok || !me || me.disabled) return json({ ok: false, error: "érvénytelen belépés" }, 401);
  let at = {}; try { at = JSON.parse(me.customAttributes || "{}") || {}; } catch (e) {}
  const isAdm = (String(me.email || "").toLowerCase() === "admin@admin.com" || at.admin === true) && !at.mustChange;
  const q = await request.json().catch(() => ({}));
  const src = isAdm && q.src ? String(q.src) : me.localId;
  if (!/^[A-Za-z0-9]{6,64}$/.test(src || "")) return json({ ok: false, error: "melyik bolt?" }, 400);
  const M = (await fsList(sa, "boltok", ["sid", "code", "loc", "place", "addr", "emps"])).map(x => ({ uid: x.id, sid: x.sid || "", code: x.code || "", loc: x.loc || "", place: x.place || "", addr: x.addr || "", emps: Array.isArray(x.emps) ? x.emps : [] }));
  const meM = M.find(x => x.uid === src) || {};
  const home = (s, l) => { s = String(s || "").toUpperCase(); let h = s ? M.find(x => x.sid && x.sid.toUpperCase() === s) : null;
    if (!h && l) { const fl = foldN(l), L = M.filter(x => x.loc && fl.startsWith(foldN(x.loc))); h = L.length === 1 ? L[0] : L.find(x => x.place && fl.includes(foldN(x.place))) || null; }
    return h; };
  const tm = t => /^\d{1,2}:\d{2}$/.test(String(t || "")) ? String(t) : "";
  const groups = {};
  (Array.isArray(q.list) ? q.list : []).slice(0, 400).forEach(x => { if (!x || !/^\d{4}-\d{2}-\d{2}$/.test(String(x.d || "")) || !x.n) return;
    const h = home(x.s, x.l); if (!h || h.uid === src) return;
    (groups[h.uid] = groups[h.uid] || []).push({ d: x.d, n: String(x.n).slice(0, 60), p: ["full", "am", "pm"].includes(x.p) ? x.p : "full", ts: tm(x.ts), te: tm(x.te) }); });
  const label = [meM.loc, meM.place].filter(Boolean).join(" ") || "másik bolt";
  const prev = await fsGet(sa, `boltok/${src}/away/_out`, ["homes"]), old = (prev && Array.isArray(prev.homes)) ? prev.homes.filter(u => /^[A-Za-z0-9]{6,64}$/.test(u)) : [];
  const today = budaToday(), notes = [];
  for (const uid of Array.from(new Set(Object.keys(groups).concat(old)))) {
    const was = parseL(((await fsGet(sa, `boltok/${uid}/away/${src}`, ["list"])) || {}).list), now = groups[uid] || [];
    if (now.length) await fsPatch(sa, `boltok/${uid}/away/${src}`, { src: label, sid: meM.code || meM.sid || "", addr: meM.addr || "", list: JSON.stringify(now), at: new Date() });
    else await fsDel(sa, `boltok/${uid}/away/${src}`);
    /* mi változott dolgozónként (csak mától előre) → 🔔 */
    const key = x => x.ts + "–" + x.te + "|" + x.p, byN = {};
    was.concat(now).forEach(x => { if (x && x.d >= today) byN[foldN(x.n)] = x.n; });
    for (const fn of Object.keys(byN)) {
      const W = Object.fromEntries(was.filter(x => foldN(x.n) === fn).map(x => [x.d, x])), N = Object.fromEntries(now.filter(x => foldN(x.n) === fn).map(x => [x.d, x]));
      const ch = Array.from(new Set(Object.keys(W).concat(Object.keys(N)))).filter(d => d >= today).sort().filter(d => (W[d] ? key(W[d]) : "") !== (N[d] ? key(N[d]) : ""));
      if (ch.length) notes.push({ uid, name: byN[fn], ch, W, N });
    }
  }
  await fsPatch(sa, `boltok/${src}/away/_out`, { homes: Object.keys(groups), at: new Date() });
  let sent = 0;
  for (const nt of notes) {
    const docs = await fsList(sa, `boltok/${nt.uid}/cal`, ["name", "t", "push", "sub", "subAll"]);
    const hm = M.find(x => x.uid === nt.uid) || {}, who = whoMatch(nt.name, (hm.emps && hm.emps.length) ? hm.emps : docs.map(x => x.name || "").filter(Boolean)) || nt.name;
    const doc = docs.find(x => x.id !== "_cfg" && foldN(x.name) === foldN(who) && x.t); if (!doc || !(doc.push || []).length) continue;
    const line = d => { const a = nt.W[d], b = nt.N[d], tt = x => x.ts ? `${x.ts}–${x.te}` : PARTN[x.p]; return !a ? `${fdHu(d)}: ${tt(b)}` : !b ? `${fdHu(d)}: törölve` : `${fdHu(d)}: ${tt(a)} → ${tt(b)}`; };
    const body = nt.ch.slice(0, 3).map(line).join("\n") + (nt.ch.length > 3 ? `\n…és még ${nt.ch.length - 3} nap` : "");
    const r = await pushTo(sa, `boltok/${nt.uid}/cal/${doc.id}`, doc, `${origin}/cal/${nt.uid}/${doc.id}/${doc.t}`, origin, `🔁 Helyettesítés · ${label}`, body, nt.ch[0], "fp-hely-" + Date.now()).catch(() => ({ sent: 0 }));
    sent += r.sent || 0;
  }
  return json({ ok: true, homes: Object.keys(groups).length, notified: sent });
}

/* ---- segédek ---- */
const esc = t => String(t == null ? "" : t).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const txt = (s, st = 200) => new Response(s, { status: st, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
const json = (o, st = 200) => new Response(JSON.stringify(o), { status: st, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const same = (a, b) => { a = String(a || ""); b = String(b || ""); if (!a || a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };
/* ki kéri a naptárfájlt? — a naptár-appok saját azonosítóval jönnek, a böngésző letöltés nem számít feliratkozásnak */
function calKind(ua) {
  ua = String(ua || "");
  if (/Google-Calendar-Importer|Google-Calendar/i.test(ua)) return "google";
  if (/dataaccessd|CalendarAgent|iCal\b|iOS\/[\d.]+ .*\(|macOS\/[\d.]+ .*\(/i.test(ua)) return "apple";
  if (/Outlook|Microsoft Office|MSOffice|Exchange/i.test(ua)) return "outlook";
  if (/Mozilla|Chrome|Safari|Firefox|curl|wget|python|bot|spider|preview/i.test(ua)) return "";
  return ua ? "naptar" : "";
}
const HU_M = ["január", "február", "március", "április", "május", "június", "július", "augusztus", "szeptember", "október", "november", "december"];
const HU_D = ["vasárnap", "hétfő", "kedd", "szerda", "csütörtök", "péntek", "szombat"];
const PART = { full: "egész nap", am: "délelőtt", pm: "délután" };
function budaToday() { const p = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Budapest", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); return p; }

function page(o) {
  const g = "https://calendar.google.com/calendar/render?cid=" + encodeURIComponent(o.web);
  const today = budaToday();
  const all = String(o.ev || "").split("\n").map(l => l.split("|")).filter(x => /^\d{4}-\d{2}-\d{2}$/.test(x[0] || ""));
  const up = all.filter(x => x[0] >= today).slice(0, 14);
  const nm = String(o.name || "").trim(), tk = nm.split(/\s+/).filter(t => !/^(dr|ifj|id|özv)\.?$/i.test(t)), first = tk.length > 1 ? tk[1] : (tk[0] || "");
  const dayInfo = k => { const [y, m, d] = k.split("-").map(Number), dt = new Date(Date.UTC(y, m - 1, d)); return { y, m, d, wd: HU_D[dt.getUTCDay()] }; };
  const rel = k => { const a = Date.UTC(...today.split("-").map((v, i) => i === 1 ? v - 1 : +v)), [y, m, d] = k.split("-").map(Number), n = Math.round((Date.UTC(y, m - 1, d) - a) / 864e5); return n === 0 ? "ma" : n === 1 ? "holnap" : n === 2 ? "holnapután" : n + " nap múlva"; };
  const row = ([k, s, e, part, mates, away]) => { const I = dayInfo(k);
    return `<li data-k="${esc(k)}"${k === today ? ' class="td"' : ""}><div class="dd p-${esc(part || "full")}"><b>${I.d}</b><small>${HU_M[I.m - 1].slice(0, 3)}.</small></div><div class="dx"><b>${k === today ? "Ma · " + I.wd : I.wd.charAt(0).toUpperCase() + I.wd.slice(1)}<em>${esc(rel(k))}</em></b><span>${s ? esc(s) + "–" + esc(e) + " · " : ""}${PART[part] || ""}</span>${away ? `<small class="aw">🔁 Helyettesítés: FirstPhone ${esc(away)}</small>` : mates ? `<small>Veled: ${esc(mates)}</small>` : ""}</div></li>`; };
  const list = up.length ? up.map(row).join("") : `<li class="no">Most nincs előtted beosztott nap.</li>`;
  /* a nagy kártya: ma / a következő műszak */
  const nx = up[0], hero = nx ? (() => { const I = dayInfo(nx[0]), isT = nx[0] === today;
    return `<div class="hero${isT ? " now" : ""}${nx[5] ? " away" : ""}"><small>${isT ? "Ma dolgozol" : "Következő műszak · " + esc(rel(nx[0]))}</small><b>${nx[1] ? esc(nx[1]) + "–" + esc(nx[2]) : esc(PART[nx[3]] || "")}</b>
      <span>${isT ? "" : `${I.wd.charAt(0).toUpperCase() + I.wd.slice(1)}, ${HU_M[I.m - 1]} ${I.d}. · `}${esc(PART[nx[3]] || "")}</span>${nx[5] ? `<em>🔁 Helyettesítés: FirstPhone ${esc(nx[5])}</em>` : nx[4] ? `<em>👥 Veled: ${esc(nx[4])}</em>` : ""}<i>${isT ? "☀️" : "📅"}</i></div>`; })()
    : `<div class="hero none"><small>Következő műszak</small><b>Most nincs</b><span>Ha jön az új beosztás, itt látod — és szól a telefonod.</span><i>🌙</i></div>`;
  const cnt = all.filter(x => x[0].slice(0, 7) === today.slice(0, 7)).length;
  /* ⏰ mai határidő (beosztás / jelenléti ív / zárások elküldése) — ✓ Elküldtem */
  const hhmm = ms => { try { return new Intl.DateTimeFormat("hu-HU", { timeZone: "Europe/Budapest", hour: "2-digit", minute: "2-digit" }).format(new Date(ms)); } catch (e) { return ""; } };
  const dutyHtml = (o.duty || []).map(x => `<div class="du${x.done ? " ok" : ""}"${x.works ? "" : " data-nw hidden"} data-dk="${esc(x.d + "|" + x.k)}"><div class="du-h"><i>${esc(x.ic)}</i><div><small>${x.done ? "Kész" : "⏰ Ma kell elküldeni"}</small><b>${esc(x.t)}</b></div></div>
    ${x.done ? `<p class="du-ok">✓ Elküldve${x.done ? " — " + esc(x.done) : ""}${x.at ? " · " + esc(hhmm(x.at)) : ""}. Köszi! Többet nem kérdezem.</p>`
      : `<p>Ma a határidő: ${esc(x.x || x.t)}. Ha elküldted, nyomd meg — és többet nem kérdezem.</p><button type="button" class="b p du-b" data-d="${esc(x.d)}" data-k="${esc(x.k)}"><i>✓</i><span>Igen, elküldtem<small>a mai dolgozóknak sem szól többet</small></span></button><div class="st du-s"></div>`}</div>`).join("");
  return `<!doctype html><html lang="hu"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="robots" content="noindex">
<title>${esc(o.name || "Beosztás")} · FirstPhone</title><link rel="manifest" href="${esc(o.base)}/manifest"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Beosztás"><meta name="apple-mobile-web-app-status-bar-style" content="black-translucent"><meta name="theme-color" content="#111116">
<link rel="apple-touch-icon" href="/cal-icon.png"><link rel="icon" href="/cal-icon.png"><style>
:root{color-scheme:dark;--bg:#0f0f14;--card:#1a1a22;--card2:#22222c;--line:#2d2d38;--tx:#f3f3f6;--dim:#a3a3b2;--gold:#f5b300;--blue:#7fa9ff;}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent;}[hidden]{display:none !important;}
html{background:var(--bg);} body{margin:0;min-height:100vh;background:radial-gradient(600px 300px at 90% -10%,rgba(245,179,0,.14),transparent 70%),var(--bg);color:var(--tx);font:16px/1.45 system-ui,-apple-system,"SF Pro Text","Segoe UI",sans-serif;padding:0 0 calc(86px + env(safe-area-inset-bottom));}
.c{max-width:460px;margin:0 auto;padding:0 16px;}
.top{position:sticky;top:0;z-index:5;display:flex;align-items:center;gap:12px;margin:0 -16px 14px;padding:calc(10px + env(safe-area-inset-top)) 16px 10px;background:rgba(15,15,20,.78);-webkit-backdrop-filter:saturate(1.5) blur(18px);backdrop-filter:saturate(1.5) blur(18px);border-bottom:1px solid rgba(255,255,255,.06);}
.top img{width:40px;height:40px;border-radius:11px;flex:none;} .top h1{font-size:19px;margin:0;line-height:1.15;font-weight:800;letter-spacing:-.01em;} .top small{display:block;color:var(--dim);font-size:12.5px;}
.pg{display:none;animation:in .25s ease;} .pg.on{display:block;} @keyframes in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
.hero{position:relative;overflow:hidden;margin:0 0 14px;padding:18px 18px 16px;border-radius:24px;background:linear-gradient(140deg,#f5b300,#e07a00);color:#1c1303;box-shadow:0 16px 40px rgba(224,122,0,.28);}
.hero.now{background:linear-gradient(140deg,#3fd08a,#16955c);color:#03190e;box-shadow:0 16px 40px rgba(22,149,92,.3);} .hero.away{background:linear-gradient(140deg,#7fa9ff,#4b6fe0);color:#06102a;} .hero.none{background:linear-gradient(140deg,#2a2a36,#1d1d26);color:var(--tx);box-shadow:none;border:1px solid var(--line);}
.hero small{display:block;font-size:12px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;opacity:.78;} .hero b{display:block;font-size:36px;line-height:1.1;font-weight:850;margin:4px 0 2px;letter-spacing:-.02em;}
.hero span{display:block;font-size:14.5px;font-weight:650;} .hero em{display:inline-block;margin-top:8px;padding:4px 10px;border-radius:99px;background:rgba(0,0,0,.14);font-style:normal;font-size:13px;font-weight:700;}
.hero i{position:absolute;right:14px;top:10px;font-style:normal;font-size:46px;opacity:.35;transform:rotate(-8deg);}
.card{background:var(--card);border:1px solid var(--line);border-radius:22px;padding:14px;margin-bottom:14px;} h2{font-size:12px;letter-spacing:.07em;text-transform:uppercase;color:var(--dim);margin:2px 2px 10px;font-weight:800;}
/* havi naptár */
.mh{display:flex;align-items:center;gap:8px;margin:0 0 8px;} .mh b{flex:1;text-align:center;font-size:16.5px;font-weight:800;} .mh button{width:38px;height:38px;border-radius:12px;border:1px solid var(--line);background:var(--card2);color:var(--tx);font-size:18px;cursor:pointer;} .mh button:disabled{opacity:.3;}
.wk,.gr{display:grid;grid-template-columns:repeat(7,1fr);gap:4px;text-align:center;} .wk span{font-size:11px;font-weight:800;color:var(--dim);padding:2px 0;}
.gr button{position:relative;aspect-ratio:1/1.05;border:0;border-radius:12px;background:transparent;color:var(--tx);font:700 14px system-ui,-apple-system,sans-serif;cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;padding:0;}
.gr button.pa{color:#5f5f6c;} .gr button.x{visibility:hidden;}
.gr button.w{background:rgba(245,179,0,.16);color:#ffd36a;} .gr button.w.am{background:linear-gradient(180deg,rgba(245,179,0,.3) 50%,rgba(245,179,0,.06) 50%);} .gr button.w.pm{background:linear-gradient(180deg,rgba(245,179,0,.06) 50%,rgba(245,179,0,.3) 50%);}
.gr button.w.aw{background:rgba(127,169,255,.2);color:#b9cfff;} .gr button.w.pa{opacity:.45;}
.gr button.t{box-shadow:inset 0 0 0 2px var(--tx);} .gr button.sel{outline:2px solid var(--gold);outline-offset:1px;}
.gr button i{font-style:normal;font-size:8.5px;font-weight:800;opacity:.85;line-height:1;}
.dsel{margin-top:10px;padding:10px 12px;border-radius:14px;background:var(--card2);font-size:14px;} .dsel b{display:block;font-size:14.5px;} .dsel small{display:block;color:var(--dim);font-size:12.5px;}
.lg{display:flex;flex-wrap:wrap;gap:6px 14px;margin-top:10px;font-size:12px;color:var(--dim);} .lg i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:5px;vertical-align:-1px;background:rgba(245,179,0,.5);} .lg i.b{background:rgba(127,169,255,.6);}
ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px;} li{display:flex;gap:12px;align-items:center;padding:10px 10px;border-radius:16px;background:var(--card2);}
li.td{background:linear-gradient(135deg,rgba(63,208,138,.2),rgba(63,208,138,.05));border:1px solid rgba(63,208,138,.45);} li.no{color:var(--dim);justify-content:center;}
.dd{width:46px;height:46px;border-radius:14px;flex:none;display:flex;flex-direction:column;align-items:center;justify-content:center;background:rgba(245,179,0,.14);} .dd b{display:block;font-size:19px;line-height:1;} .dd small{color:var(--gold);font-weight:800;font-size:11px;}
.dx{min-width:0;flex:1;} .dx b{display:flex;align-items:center;gap:8px;font-size:14.5px;} .dx b em{margin-left:auto;font-style:normal;font-size:11.5px;font-weight:700;color:var(--dim);} .dx small.aw{color:var(--blue);font-weight:700;} .dx span{display:block;font-size:13.5px;color:#e8e8ee;} .dx small{display:block;font-size:12px;color:var(--dim);}
a.b,button.b{display:flex;width:100%;align-items:center;gap:12px;padding:14px 15px;border-radius:16px;margin-top:9px;text-decoration:none;color:#fff;font:inherit;font-weight:700;background:var(--card2);border:1px solid #34343f;text-align:left;cursor:pointer;}
a.b small,button.b small{display:block;font-weight:500;color:var(--dim);font-size:12.5px;} a.b i,button.b i{font-style:normal;font-size:23px;} .b.p{background:linear-gradient(135deg,#f5b300,#e08a00);color:#1b1404;border:0;} .b.p small{color:#3a2a05;}
.b:disabled{opacity:.55;} .st{margin-top:10px;font-size:13.5px;color:var(--dim);} .st.ok{color:#30b37a;font-weight:700;} .st.err{color:#ef5a5a;}
.how{margin:10px 0 0;padding:0 0 0 20px;color:#d6d6de;font-size:14px;} .how li{display:list-item;background:none;padding:2px 0;}
.f{margin:6px 0 10px;font-size:12px;color:#6f6f7c;text-align:center;}
li.hl{outline:2px solid var(--gold);animation:hl 1.2s ease 2;} @keyframes hl{50%{transform:scale(1.03);}}
.oc{border-color:rgba(245,179,0,.6);background:linear-gradient(135deg,rgba(245,179,0,.16),var(--card) 70%);} .oc p{margin:0;color:#d6d6de;font-size:14px;}
.nt{font-size:14.5px;color:#dcdce4;}
.du{position:relative;margin:0 0 14px;padding:15px 15px 14px;border-radius:22px;background:linear-gradient(135deg,rgba(239,90,90,.22),var(--card) 75%);border:1px solid rgba(239,90,90,.55);animation:duIn .45s cubic-bezier(.2,.9,.3,1.2);}
.du.ok{background:linear-gradient(135deg,rgba(63,208,138,.18),var(--card) 75%);border-color:rgba(63,208,138,.5);animation:none;}
.du-h{display:flex;align-items:center;gap:12px;} .du-h i{font-style:normal;font-size:30px;width:50px;height:50px;border-radius:15px;display:grid;place-items:center;background:rgba(0,0,0,.25);flex:none;}
.du:not(.ok) .du-h i{animation:duP 1.6s ease-in-out infinite;} .du-h small{display:block;font-size:11.5px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:#ff9b9b;} .du.ok .du-h small{color:#5fe0a2;}
.du-h b{display:block;font-size:18px;line-height:1.2;} .du p{margin:10px 0 0;font-size:14px;color:#dcdce4;} .du p.du-ok{color:#7fe8b4;font-weight:700;}
@keyframes duIn{from{opacity:0;transform:translateY(-8px) scale(.97)}to{opacity:1;transform:none}} @keyframes duP{0%,100%{transform:scale(1)}50%{transform:scale(1.1) rotate(-6deg)}}
@media (prefers-reduced-motion:reduce){.du,.du-h i{animation:none !important;}}
/* alsó tab-sáv */
.tb{position:fixed;left:0;right:0;bottom:0;z-index:6;display:grid;grid-template-columns:repeat(3,1fr);padding:6px 10px calc(8px + env(safe-area-inset-bottom));background:rgba(20,20,27,.86);-webkit-backdrop-filter:saturate(1.5) blur(18px);backdrop-filter:saturate(1.5) blur(18px);border-top:1px solid rgba(255,255,255,.07);}
.tb button{position:relative;display:flex;flex-direction:column;align-items:center;gap:3px;padding:6px 2px 4px;border:0;background:none;color:var(--dim);font:700 11px system-ui,-apple-system,sans-serif;cursor:pointer;}
.tb button i{font-style:normal;width:46px;height:30px;border-radius:99px;display:grid;place-items:center;font-size:19px;transition:background .2s;} .tb button.on{color:var(--tx);} .tb button.on i{background:rgba(245,179,0,.22);box-shadow:inset 0 0 0 1px rgba(245,179,0,.4);}
.tb button .dot{position:absolute;top:4px;left:calc(50% + 10px);width:9px;height:9px;border-radius:50%;background:#ef5a5a;box-shadow:0 0 0 2px #14141b;}
</style></head><body><div class="c">
<div class="top"><img src="/cal-icon.png" alt=""><div><h1>${first ? "Szia, " + esc(first) + "! 👋" : esc(o.name || "Beosztás")}</h1><small>${esc(o.shop ? o.shop + " · " : "FirstPhone · ")}${esc(nm || "a te műszakjaid")}</small></div></div>
<section class="pg on" data-pg="m">
<div class="card oc" id="oc" hidden><h2>📅 Az értesítésből jöttél</h2><p id="ocx"></p><a class="b p" id="ob" href="#"><i>📅</i><span>Megnyitás a naptárban<small id="obs">azon a napon</small></span></a></div>
${dutyHtml}${hero}
<div class="card" id="cal"><div class="mh"><button type="button" id="mp" aria-label="Előző hónap">‹</button><b id="ml"></b><button type="button" id="mn" aria-label="Következő hónap">›</button></div>
<div class="wk"><span>H</span><span>K</span><span>Sze</span><span>Cs</span><span>P</span><span>Szo</span><span>V</span></div><div class="gr" id="gr"></div><div class="dsel" id="ds" hidden></div>
<div class="lg"><span><i></i>dolgozol${cnt ? " · ebben a hónapban " + cnt + " nap" : ""}</span><span><i class="b"></i>helyettesítés</span></div></div>
<div class="card"><h2>Következő műszakjaid</h2><ul>${list}</ul></div>
</section>
<section class="pg" data-pg="n"><div class="card"><h2>🔔 Értesítés</h2><div class="nt" id="nt">Ha új havi beosztás jön, vagy változik a beosztásod, a telefonod szól.</div>
<button class="b p" id="nb" type="button" hidden><i>🔔</i><span>Értesítést kérek<small>egyszer kell engedélyezni</small></span></button>
<button class="b" id="nx" type="button" hidden><i>📨</i><span>Próba értesítés<small>így fog kinézni</small></span></button>
<div class="st" id="ns"></div></div></section>
<section class="pg" data-pg="c"><div class="card"><h2>📅 A naptáradba</h2>
<a class="b p" href="${esc(o.web.replace(/^https:/, "webcal:"))}"><i>🍎</i><span>iPhone / iPad / Mac naptár<small>Feliratkozás → magától frissül</small></span></a>
<a class="b" href="${esc(g)}"><i>🗓️</i><span>Google Naptár<small>Android, Gmail — „Hozzáadás” gomb</small></span></a>
<a class="b" id="oa" href="calshow:" hidden><i>📆</i><span>Naptár app megnyitása<small>ha már feliratkoztál</small></span></a>
<a class="b" href="${esc(o.ics)}"><i>⬇️</i><span>Csak letöltés (.ics)<small>egyszeri, nem frissül magától</small></span></a></div></section>
<div class="f">FirstPhone Munkaasztal</div></div>
<nav class="tb" id="tb"><button type="button" class="on" data-to="m"><i>📅</i>Műszakok</button><button type="button" data-to="n"><i>🔔</i>Értesítés<span class="dot" id="tbd" hidden></span></button><button type="button" data-to="c"><i>🗓️</i>Naptárba</button></nav>
<script>
/* fülek + havi naptár (a műszakok a beosztásból) */
(function(){
  var EV=${JSON.stringify(all.map(x => x.slice(0, 6))).replace(/</g, "\\u003c")}, TODAY=${JSON.stringify(today)};
  var HM=['január','február','március','április','május','június','július','augusztus','szeptember','október','november','december'], HD=['vasárnap','hétfő','kedd','szerda','csütörtök','péntek','szombat'], PT={full:'egész nap',am:'délelőtt',pm:'délután'};
  var tb=document.getElementById('tb');
  function show(k){ Array.prototype.forEach.call(document.querySelectorAll('.pg'),function(p){ p.classList.toggle('on',p.dataset.pg===k); }); Array.prototype.forEach.call(tb.querySelectorAll('button'),function(b){ b.classList.toggle('on',b.dataset.to===k); }); try{ window.scrollTo(0,0); }catch(e){} try{ sessionStorage.setItem('fp_cal_tab',k); }catch(e){} }
  tb.addEventListener('click',function(e){ var b=e.target.closest('button'); if(b) show(b.dataset.to); });
  window.fpCalTab=show;
  var M={}; EV.forEach(function(x){ (M[x[0]]=M[x[0]]||[]).push(x); });
  var months=Object.keys(M).map(function(k){ return k.slice(0,7); }).concat([TODAY.slice(0,7)]).filter(function(v,i,a){ return a.indexOf(v)===i; }).sort();
  var cur=TODAY.slice(0,7), sel='';
  var gr=document.getElementById('gr'), ml=document.getElementById('ml'), ds=document.getElementById('ds'), mp=document.getElementById('mp'), mn=document.getElementById('mn');
  function p2(n){ return (n<10?'0':'')+n; }
  function draw(){ var y=+cur.slice(0,4), m=+cur.slice(5,7), f=(new Date(y,m-1,1).getDay()+6)%7, n=new Date(y,m,0).getDate(), h='';
    ml.textContent=HM[m-1].charAt(0).toUpperCase()+HM[m-1].slice(1)+' '+y;
    for(var i=0;i<f;i++) h+='<button type="button" class="x" tabindex="-1"></button>';
    for(var d=1;d<=n;d++){ var k=y+'-'+p2(m)+'-'+p2(d), L=M[k]||[], c=[]; if(L.length){ c.push('w'); var pp=L.map(function(x){return x[3];}); if(pp.length===1&&pp[0]==='am') c.push('am'); if(pp.length===1&&pp[0]==='pm') c.push('pm'); if(L.some(function(x){return x[5];})) c.push('aw'); }
      if(k<TODAY) c.push('pa'); if(k===TODAY) c.push('t'); if(k===sel) c.push('sel');
      h+='<button type="button" data-k="'+k+'" class="'+c.join(' ')+'">'+d+(L.length?'<i>'+(L[0][1]||'')+'</i>':'')+'</button>'; }
    gr.innerHTML=h; var ix=months.indexOf(cur); mp.disabled=ix<=0; mn.disabled=ix<0||ix>=months.length-1; }
  function pick(k){ sel=k; var L=M[k]||[], p=k.split('-').map(Number), wd=HD[new Date(p[0],p[1]-1,p[2]).getDay()];
    ds.hidden=false; ds.innerHTML='<b>'+HM[p[1]-1].charAt(0).toUpperCase()+HM[p[1]-1].slice(1)+' '+p[2]+'., '+wd+'</b>'+(L.length?L.map(function(x){ return '<small>'+(x[1]?x[1]+'–'+x[2]+' · ':'')+(PT[x[3]]||'')+(x[5]?' · 🔁 FirstPhone '+x[5]:x[4]?' · veled: '+x[4]:'')+'</small>'; }).join(''):'<small>Ezen a napon nem dolgozol.</small>'); draw(); }
  gr.addEventListener('click',function(e){ var b=e.target.closest('button[data-k]'); if(b) pick(b.dataset.k); });
  mp.onclick=function(){ var ix=months.indexOf(cur); if(ix>0){ cur=months[ix-1]; draw(); } };
  mn.onclick=function(){ var ix=months.indexOf(cur); if(ix<months.length-1){ cur=months[ix+1]; draw(); } };
  draw();
  try{ var t0=sessionStorage.getItem('fp_cal_tab'); if(t0&&t0!=='m'&&!/[?&]open=cal/.test(location.search)) show(t0); }catch(e){}
})();
</script>
<script>
(function(){
  var BASE=${JSON.stringify(o.base)}, KEY=${JSON.stringify(o.vapid || "")};
  var nb=document.getElementById('nb'), nx=document.getElementById('nx'), ns=document.getElementById('ns'), nt=document.getElementById('nt');
  /* ⏰ „✓ Igen, elküldtem” (iPhone-on az értesítésen nincs gomb — ide jön) */
  try{ var dq=new URLSearchParams(location.search).get('duty'); if(dq){ var de=document.querySelector('.du[data-dk="'+dq.replace(/"/g,'')+'"]'); if(de){ de.hidden=false; try{ de.scrollIntoView({block:'start'}); }catch(e){} } try{ history.replaceState(null,'',location.pathname); }catch(e){} } }catch(e){}
  Array.prototype.forEach.call(document.querySelectorAll('.du-b'),function(b){ b.onclick=function(){ var box=b.closest('.du'), s=box.querySelector('.du-s'); b.disabled=true; s.className='st du-s'; s.textContent='Mentés…';
    fetch(BASE+'/done',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({d:b.dataset.d,k:b.dataset.k,src:'page'})}).then(function(r){ return r.json(); }).then(function(j){
      if(!j.ok) throw new Error(j.error||'hiba'); box.classList.add('ok'); box.querySelector('.du-h small').textContent='Kész';
      var p=box.querySelector('p'); p.className='du-ok'; p.textContent='✓ Elküldve'+(j.by?' — '+j.by:'')+'. Köszi! Többet nem kérdezem.'; b.remove(); s.remove();
      try{ navigator.serviceWorker && navigator.serviceWorker.getRegistration('/cal/').then(function(r){ if(r) r.getNotifications().then(function(L){ L.forEach(function(n){ if(n.data&&n.data.k===b.dataset.k) n.close(); }); }); }); }catch(e){}
    }).catch(function(e){ b.disabled=false; s.className='st du-s err'; s.textContent='Nem sikerült: '+e.message+' — próbáld újra.'; }); }; });
  var ios=/iPhone|iPad|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
  var standalone=window.navigator.standalone===true||matchMedia('(display-mode: standalone)').matches;
  function st(t,c){ ns.textContent=t; ns.className='st'+(c?' '+c:''); }
  (function(){ var d=document.getElementById('tbd'); if(!d) return; function u(){ d.hidden=!( !nb.hidden || /Főképernyő/.test(nt.textContent) ); } new MutationObserver(u).observe(nb,{attributes:true}); new MutationObserver(u).observe(nt,{childList:true,subtree:true}); u(); })();
  /* értesítésre kattintva: ?open=cal&d=ÉÉÉÉ-HH-NN → a naptár megnyitása azon a napon */
  function calUrl(k){ var p=String(k||'').split('-').map(Number); if(p.length<3||!p[0]) return ''; if(ios) return 'calshow:'+Math.round(new Date(p[0],p[1]-1,p[2],9,0).getTime()/1000-978307200); return 'https://calendar.google.com/calendar/r/day/'+p[0]+'/'+p[1]+'/'+p[2]; }
  var HM=['január','február','március','április','május','június','július','augusztus','szeptember','október','november','december'];
  if(ios){ var oa=document.getElementById('oa'); oa.hidden=false; oa.href=calUrl(new Date().toISOString().slice(0,10)); }
  try{ var q=new URLSearchParams(location.search), od=q.get('d');
    if(q.get('open')==='cal' && /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(od||'')){ var u=calUrl(od), pp=od.split('-').map(Number);
      document.getElementById('oc').hidden=false; document.getElementById('ob').href=u;
      document.getElementById('obs').textContent=HM[pp[1]-1]+' '+pp[2]+'. — '+(ios?'iPhone Naptár':'Google Naptár');
      document.getElementById('ocx').textContent='Nyílik a naptárad… ha nem nyílt meg magától, nyomd meg a gombot.';
      var li=document.querySelector('li[data-k="'+od+'"]'); if(li){ li.classList.add('hl'); }
      setTimeout(function(){ location.href=u; },350);
      try{ history.replaceState(null,'',location.pathname); }catch(e){}
    } }catch(e){}
  function k8(s){ s=s.replace(/-/g,'+').replace(/_/g,'/'); while(s.length%4) s+='='; var b=atob(s), a=new Uint8Array(b.length); for(var i=0;i<b.length;i++) a[i]=b.charCodeAt(i); return a; }
  if(!KEY){ st('Az értesítés most nem érhető el.','err'); return; }
  if(ios && !standalone){ nt.innerHTML='iPhone-on előbb tedd ki ezt az oldalt a <b>főképernyőre</b>, és onnan nyisd meg:<ol class="how"><li>Lent a <b>Megosztás</b> gomb (négyzet felfelé nyíllal)</li><li><b>„Főképernyőhöz adás”</b> → Hozzáadás</li><li>Nyisd meg a főképernyőről a <b>Beosztás</b> ikont, és ott nyomd meg az 🔔 gombot</li></ol>'; return; }
  if(!('serviceWorker' in navigator)||!('PushManager' in window)||!('Notification' in window)){ st('Ez a böngésző nem tud értesítést küldeni — próbáld Chrome-ban (Android) vagy iPhone-on a főképernyőről.','err'); return; }
  var reg=null;
  function on(){ nb.hidden=true; nx.hidden=false; st('✓ Értesítés bekapcsolva ezen a telefonon.','ok'); }
  navigator.serviceWorker.register('/cal-sw.js',{scope:'/cal/'}).then(function(r){ reg=r; return navigator.serviceWorker.ready; }).then(function(){ return reg.pushManager.getSubscription(); }).then(function(s){
    if(s && Notification.permission==='granted'){ on(); fetch(BASE+'/push',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sub:s})}); }
    else { nb.hidden=false; if(Notification.permission==='denied') st('Az értesítés le van tiltva a telefon beállításaiban — ott engedélyezd.','err'); }
  }).catch(function(e){ nb.hidden=false; st('Hiba: '+e.message,'err'); });
  nb.onclick=function(){ nb.disabled=true; st('Engedélyezés…');
    Notification.requestPermission().then(function(p){ if(p!=='granted') throw new Error('nem engedélyezted az értesítést');
      return (reg ? Promise.resolve(reg) : navigator.serviceWorker.register('/cal-sw.js',{scope:'/cal/'}).then(function(){ return navigator.serviceWorker.ready; })).then(function(r){ reg=r; return r.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:k8(KEY)}); }); })
    .then(function(s){ return fetch(BASE+'/push',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sub:s})}).then(function(r){ if(!r.ok) throw new Error('mentés '+r.status); }); })
    .then(function(){ on(); }).catch(function(e){ st('Nem sikerült: '+e.message,'err'); }).then(function(){ nb.disabled=false; }); };
  nx.onclick=function(){ nx.disabled=true; fetch(BASE+'/notify',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({test:1})}).then(function(r){ return r.json(); }).then(function(j){ st(j.sent?'📨 Elküldve — pár másodperc és megjön.':'Nem ment ki — kapcsold ki-be az értesítést.', j.sent?'ok':'err'); }).catch(function(){ st('Nem sikerült elküldeni.','err'); }).then(function(){ nx.disabled=false; }); };
})();
</script></body></html>`;
}

export async function onRequest(context) {
  const { request, env, params } = context;
  const seg = [].concat(params.p || []);
  if (seg.length === 1 && seg[0] === "_out") {
    if (request.method !== "POST") return txt("POST kell", 405);
    let sa0; try { sa0 = JSON.parse(env.FIREBASE_SA || ""); } catch (e) { sa0 = null; }
    if (!sa0 || !sa0.private_key) return json({ ok: false, error: "nosa" }, 503);
    try { return await handleOut(request, sa0, new URL(request.url).origin); } catch (e) { return json({ ok: false, error: String((e && e.message) || e) }, 502); }
  }
  if (seg.length <= 2 && seg[0] === "_tick") {
    let sa0; try { sa0 = JSON.parse(env.FIREBASE_SA || ""); } catch (e) { sa0 = null; }
    if (!sa0 || !sa0.private_key) return json({ ok: false, error: "nosa" }, 503);
    const origin = new URL(request.url).origin;
    let b = {}; if (request.method === "POST") b = await request.json().catch(() => ({}));
    const one = String(b.uid || seg[1] || "");
    try {
      if (one) { if (!/^[A-Za-z0-9]{6,64}$/.test(one)) return json({ ok: false, error: "uid" }, 400); return json(Object.assign({ ok: true }, await dutyTick(sa0, one, origin))); }
      const shops = await fsList(sa0, "boltok", ["loc"]), res = [];
      for (const x of shops.slice(0, 40)) res.push(await dutyTick(sa0, x.id, origin).catch(e => ({ uid: x.id, error: String((e && e.message) || e) })));
      return json({ ok: true, res: res.filter(r => r.n || r.error) });
    } catch (e) { return json({ ok: false, error: String((e && e.message) || e) }, 502); }
  }
  if (seg.length < 3 || seg.length > 4) return txt("Hiányos naptár link.", 404);
  let [uid, emp, tok, act] = seg; const isIcs = /\.ics$/i.test(tok); tok = tok.replace(/\.ics$/i, "");
  if (!/^[A-Za-z0-9]{6,64}$/.test(uid) || !/^[A-Za-z0-9_-]{2,40}$/.test(emp) || !/^[A-Za-z0-9]{16,64}$/.test(tok) || (act && !/^(push|notify|manifest|done)$/.test(act)) || (act && isIcs)) return txt("Hibás naptár link.", 404);
  const M = request.method;
  if (act === "push" || act === "notify" || act === "done") { if (M !== "POST") return txt("POST kell", 405); }
  else if (M !== "GET" && M !== "HEAD") return txt("GET kell", 405);
  let sa; try { sa = JSON.parse(env.FIREBASE_SA || ""); } catch (e) { sa = null; }
  if (!sa || !sa.private_key) return txt("A naptár szolgáltatás nincs beállítva.", 503);
  const path = `boltok/${uid}/cal/${emp}`, url = new URL(request.url);
  const base = `${url.origin}/cal/${uid}/${emp}/${tok}`;
  try {
    const d = await fsGet(sa, path, ["t", "ics", "ev", "name", "sub", "subAll", "subAt", "push"]);
    if (!d) return txt("Ez a naptár nem létezik (vagy törölték).", 404);
    if (!same(d.t, tok)) return txt("Ez a naptár link már nem érvényes.", 404);

    if (isIcs) {
      /* feliratkozás felismerése: ha naptár-app kéri (nem böngésző), feljegyezzük — legfeljebb 6 óránként írunk */
      const k = calKind(request.headers.get("user-agent"));
      if (k) {
        const all = String(d.subAll || "").split(",").filter(Boolean); const fresh = d.subAt && Date.now() - Date.parse(d.subAt) < 6 * 3600e3;
        if (!all.includes(k) || d.sub !== k || !fresh) { if (!all.includes(k)) all.push(k);
          context.waitUntil(fsPatch(sa, path, { sub: k, subAll: all.join(","), subAt: new Date() }).catch(() => {})); }
      }
      /* + ahol másik boltban helyettesít (a másik bolt küldte) */
      let ics = d.ics || ("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//FirstPhone//Munkaasztal//HU\r\nX-WR-TIMEZONE:Europe/Budapest\r\n" + VTZ + "\r\nEND:VCALENDAR\r\n");
      try { const A = await awayOf(sa, uid, d.name); if (A.length) ics = ics.replace(/END:VCALENDAR\s*$/, awayIcs(A, emp) + "\r\nEND:VCALENDAR\r\n"); } catch (e) {}
      return new Response(ics, { headers: { "content-type": "text/calendar; charset=utf-8", "content-disposition": `inline; filename="beosztas.ics"`, "cache-control": "private, max-age=300" } });
    }
    if (act === "manifest") {
      return new Response(JSON.stringify({ name: "FirstPhone beosztás – " + (d.name || ""), short_name: "Beosztás", start_url: base, scope: "/cal/", display: "standalone", background_color: "#111116", theme_color: "#111116",
        icons: [{ src: "/cal-icon.png", sizes: "180x180", type: "image/png" }, { src: "/cal-icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" }] }), { headers: { "content-type": "application/manifest+json; charset=utf-8", "cache-control": "no-store" } });
    }
    if (act === "push") {
      const b = await request.json().catch(() => ({}));
      const L = (d.push || []).map(x => { try { return JSON.parse(x); } catch (e) { return null; } }).filter(Boolean);
      if (b.off) { const R = L.filter(x => x.endpoint !== b.off); await fsPatch(sa, path, { push: R.map(x => JSON.stringify(x)), pushN: R.length }); return json({ ok: true, n: R.length }); }
      const s = b.sub || {}; const ep = String(s.endpoint || "");
      if (!/^https:\/\/[^\s]{10,900}$/.test(ep) || !s.keys || !/^[A-Za-z0-9_-]{80,100}$/.test(s.keys.p256dh || "") || !/^[A-Za-z0-9_-]{16,30}$/.test(s.keys.auth || "")) return json({ ok: false, error: "hibás feliratkozás" }, 400);
      const R = L.filter(x => x.endpoint !== ep).concat([{ endpoint: ep, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth }, ua: String(request.headers.get("user-agent") || "").slice(0, 160), at: Date.now() }]).slice(-5);
      await fsPatch(sa, path, { push: R.map(x => JSON.stringify(x)), pushN: R.length, pushAt: new Date() });
      return json({ ok: true, n: R.length });
    }
    if (act === "done") {
      const b = await request.json().catch(() => ({}));
      const bolt = b.src === "bolt";
      return json(await dutyDone(sa, uid, b.d, b.k, bolt ? (String(b.by || "").replace(/[<>|\n]/g, " ").trim().slice(0, 40) ? String(b.by).replace(/[<>|\n]/g, " ").trim().slice(0, 40) + " (a boltból)" : "a bolt (Munkaasztal)") : d.name, bolt ? "bolt" : b.src === "page" ? "oldal" : "értesítés", !!b.undo));
    }
    if (act === "notify") {
      const b = await request.json().catch(() => ({}));
      const title = b.test ? "🔔 Próba értesítés" : String(b.title || "").slice(0, 90), body = b.test ? "Így szól, ha jön az új havi beosztás, vagy változik a tiéd — koppints rá, és megnyílik a naptárad." : String(b.body || "").slice(0, 400);
      if (!title) return json({ ok: false, error: "nincs cím" }, 400);
      /* rákattintva a naptár nyíljon meg, azon a napon */
      const r = await pushTo(sa, path, d, base, url.origin, title, body, b.d, b.test ? "fp-cal-test" : "fp-cal-" + Date.now());
      return json(Object.assign({ ok: true }, r));
    }
    let vk = ""; try { vk = (await vapid(sa)).pub; } catch (e) {}
    let ev = String(d.ev || "");
    try { const A = await awayOf(sa, uid, d.name); if (A.length) ev = ev.split("\n").filter(Boolean).concat(A.map(x => [x.d, x.ts, x.te, x.p, "", x.at].join("|"))).sort().join("\n"); } catch (e) {}
    let shop = ""; try { const sh = await fsGet(sa, "boltok/" + uid, ["loc", "place"]); if (sh && sh.loc) shop = "FirstPhone " + sh.loc + (sh.place ? " " + String(sh.place).split(/[,(]/)[0].trim() : ""); } catch (e) {}
    let duty = []; try { duty = await dutyFor(sa, uid, d.ev); } catch (e) {}
    if (duty.some(x => !x.done)) context.waitUntil(dutyTick(sa, uid, url.origin).catch(() => {}));
    return new Response(page({ name: d.name, ev, base, ics: base + ".ics", web: base + ".ics", vapid: vk, shop, duty }), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" } });
  } catch (e) {
    return txt("Hiba: " + String((e && e.message) || e), 502);
  }
}
