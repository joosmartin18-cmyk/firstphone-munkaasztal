/* FirstPhone Munkaasztal — 📅 beosztás a dolgozók saját naptárában + 🔔 értesítés (Cloudflare Pages Function, ingyenes)
   A Munkaasztal (Beosztás → 📅 Naptárba) dolgozónként elkészíti a műszakok naptárfájlját (.ics) és a bolt saját
   Firestore helyére menti: boltok/{bolt}/cal/{dolgozó} = { t: titkos kulcs, ics, ev, name, … }.
     GET  /cal/{bolt}/{dolgozó}/{kulcs}.ics          → text/calendar (erre iratkozik fel a naptár) — és felismeri,
                                                       hogy iPhone / Google / Outlook naptár kérte-e (= feliratkozott)
     GET  /cal/{bolt}/{dolgozó}/{kulcs}              → kis oldal: következő műszakok, iPhone / Google gomb, 🔔 értesítés
     GET  /cal/{bolt}/{dolgozó}/{kulcs}/manifest     → a főképernyőre tett „app” leírója (iPhone-on így kap értesítést)
     POST /cal/{bolt}/{dolgozó}/{kulcs}/push         → a telefon értesítési címének mentése / törlése
     POST /cal/{bolt}/{dolgozó}/{kulcs}/notify       → értesítés küldése (a Munkaasztal hívja, ha új hónap jön vagy változik)
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
  const body = b64uStr(JSON.stringify({ iss: sa.client_email, scope: "https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/cloud-platform", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }));
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
  const q = Object.keys(data).map(k => "updateMask.fieldPaths=" + encodeURIComponent(k)).concat(opt && opt.create ? ["currentDocument.exists=false"] : []).join("&");
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
async function wpSend(sa, sub, payload, origin) {
  const v = await vapid(sa), u = new URL(sub.endpoint), now = Math.floor(Date.now() / 1000);
  const h = b64uStr(JSON.stringify({ typ: "JWT", alg: "ES256" })) + "." + b64uStr(JSON.stringify({ aud: u.origin, exp: now + 50 * 60, sub: origin }));
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, v.key, enc.encode(h));
  const body = await wpEncrypt(payload, sub.keys.p256dh, sub.keys.auth);
  const r = await fetch(sub.endpoint, { method: "POST", headers: { authorization: `vapid t=${h}.${b64u(sig)}, k=${v.pub}`, "content-encoding": "aes128gcm", "content-type": "application/octet-stream", ttl: "86400", urgency: "normal" }, body });
  return r.status;
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
  const up = String(o.ev || "").split("\n").map(l => l.split("|")).filter(x => x[0] && x[0] >= today).slice(0, 14);
  const list = up.length ? up.map(([k, s, e, part, mates, away]) => { const [y, m, d] = k.split("-").map(Number), dt = new Date(Date.UTC(y, m - 1, d)), wd = HU_D[dt.getUTCDay()];
    return `<li data-k="${esc(k)}"${k === today ? ' class="td"' : ""}><div class="dd"><b>${d}</b><small>${HU_M[m - 1].slice(0, 3)}.</small></div><div class="dx"><b>${k === today ? "Ma · " + wd : wd.charAt(0).toUpperCase() + wd.slice(1)}</b><span>${s ? esc(s) + "–" + esc(e) + " · " : ""}${PART[part] || ""}</span>${away ? `<small class="aw">🔁 Helyettesítés: FirstPhone ${esc(away)}</small>` : mates ? `<small>Veled: ${esc(mates)}</small>` : ""}</div></li>`; }).join("")
    : `<li class="no">Most nincs előtted beosztott nap.</li>`;
  return `<!doctype html><html lang="hu"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="robots" content="noindex">
<title>${esc(o.name || "Beosztás")} · FirstPhone</title><link rel="manifest" href="${esc(o.base)}/manifest"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Beosztás"><meta name="apple-mobile-web-app-status-bar-style" content="black-translucent"><meta name="theme-color" content="#111116">
<link rel="apple-touch-icon" href="/cal-icon.png"><link rel="icon" href="/cal-icon.png"><style>
:root{color-scheme:dark;}*{box-sizing:border-box;}[hidden]{display:none !important;}body{margin:0;min-height:100vh;background:#111116;color:#f2f2f5;font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;padding:max(18px,env(safe-area-inset-top)) 16px 28px;}
.c{max-width:440px;margin:0 auto;} .top{display:flex;align-items:center;gap:12px;margin:6px 0 16px;} .top img{width:46px;height:46px;border-radius:12px;}
h1{font-size:20px;margin:0;line-height:1.2;} .top small{display:block;color:#a9a9b6;font-size:13px;}
.card{background:#1b1b22;border:1px solid #2c2c36;border-radius:20px;padding:16px;margin-bottom:14px;} h2{font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:#a9a9b6;margin:0 0 10px;}
ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px;} li{display:flex;gap:12px;align-items:center;padding:9px 10px;border-radius:14px;background:#23232c;}
li.td{background:linear-gradient(135deg,rgba(245,179,0,.22),rgba(245,179,0,.06));border:1px solid rgba(245,179,0,.45);} li.no{color:#a9a9b6;justify-content:center;}
.dd{width:44px;text-align:center;flex:none;} .dd b{display:block;font-size:20px;line-height:1;} .dd small{color:#f5b300;font-weight:700;font-size:12px;}
.dx b{display:block;font-size:14.5px;} .dx small.aw{color:#7fa9ff;font-weight:700;} .dx span{display:block;font-size:13.5px;color:#e8e8ee;} .dx small{display:block;font-size:12px;color:#a9a9b6;}
a.b,button.b{display:flex;width:100%;align-items:center;gap:12px;padding:14px 15px;border-radius:15px;margin-top:9px;text-decoration:none;color:#fff;font:inherit;font-weight:700;background:#26262f;border:1px solid #34343f;text-align:left;cursor:pointer;}
a.b small,button.b small{display:block;font-weight:500;color:#a9a9b6;font-size:12.5px;} a.b i,button.b i{font-style:normal;font-size:23px;} .b.p{background:linear-gradient(135deg,#f5b300,#e08a00);color:#1b1404;border:0;} .b.p small{color:#3a2a05;}
.b:disabled{opacity:.55;} .st{margin-top:10px;font-size:13.5px;color:#a9a9b6;} .st.ok{color:#30b37a;font-weight:700;} .st.err{color:#ef5a5a;}
.how{margin:10px 0 0;padding:0 0 0 20px;color:#d6d6de;font-size:14px;} .how li{display:list-item;background:none;padding:2px 0;}
.f{margin-top:6px;font-size:12px;color:#6f6f7c;text-align:center;}
li.hl{outline:2px solid #f5b300;animation:hl 1.2s ease 2;} @keyframes hl{50%{transform:scale(1.03);}}
.oc{border-color:rgba(245,179,0,.6);background:linear-gradient(135deg,rgba(245,179,0,.16),#1b1b22 70%);} .oc p{margin:0;color:#d6d6de;font-size:14px;}
</style></head><body><div class="c">
<div class="top"><img src="/cal-icon.png" alt=""><div><h1>${esc(o.name || "Beosztás")}</h1><small>FirstPhone beosztás · a te műszakjaid</small></div></div>
<div class="card oc" id="oc" hidden><h2>📅 Az értesítésből jöttél</h2><p id="ocx"></p><a class="b p" id="ob" href="#"><i>📅</i><span>Megnyitás a naptárban<small id="obs">azon a napon</small></span></a></div>
<div class="card"><h2>Következő műszakjaid</h2><ul>${list}</ul></div>
<div class="card"><h2>🔔 Értesítés</h2><div id="nt">Ha új havi beosztás jön, vagy változik a beosztásod, a telefonod szól.</div>
<button class="b p" id="nb" type="button" hidden><i>🔔</i><span>Értesítést kérek<small>egyszer kell engedélyezni</small></span></button>
<button class="b" id="nx" type="button" hidden><i>📨</i><span>Próba értesítés<small>így fog kinézni</small></span></button>
<div class="st" id="ns"></div></div>
<div class="card"><h2>📅 A naptáradba</h2>
<a class="b p" href="${esc(o.web.replace(/^https:/, "webcal:"))}"><i>🍎</i><span>iPhone / iPad / Mac naptár<small>Feliratkozás → magától frissül</small></span></a>
<a class="b" href="${esc(g)}"><i>🗓️</i><span>Google Naptár<small>Android, Gmail — „Hozzáadás” gomb</small></span></a>
<a class="b" id="oa" href="calshow:" hidden><i>📆</i><span>Naptár app megnyitása<small>ha már feliratkoztál</small></span></a>
<a class="b" href="${esc(o.ics)}"><i>⬇️</i><span>Csak letöltés (.ics)<small>egyszeri, nem frissül magától</small></span></a></div>
<div class="f">FirstPhone Munkaasztal</div></div>
<script>
(function(){
  var BASE=${JSON.stringify(o.base)}, KEY=${JSON.stringify(o.vapid || "")};
  var nb=document.getElementById('nb'), nx=document.getElementById('nx'), ns=document.getElementById('ns'), nt=document.getElementById('nt');
  var ios=/iPhone|iPad|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
  var standalone=window.navigator.standalone===true||matchMedia('(display-mode: standalone)').matches;
  function st(t,c){ ns.textContent=t; ns.className='st'+(c?' '+c:''); }
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
  if (seg.length < 3 || seg.length > 4) return txt("Hiányos naptár link.", 404);
  let [uid, emp, tok, act] = seg; const isIcs = /\.ics$/i.test(tok); tok = tok.replace(/\.ics$/i, "");
  if (!/^[A-Za-z0-9]{6,64}$/.test(uid) || !/^[A-Za-z0-9_-]{2,40}$/.test(emp) || !/^[A-Za-z0-9]{16,64}$/.test(tok) || (act && !/^(push|notify|manifest)$/.test(act)) || (act && isIcs)) return txt("Hibás naptár link.", 404);
  const M = request.method;
  if (act === "push" || act === "notify") { if (M !== "POST") return txt("POST kell", 405); }
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
      return new Response(d.ics || "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//FirstPhone//Munkaasztal//HU\r\nEND:VCALENDAR\r\n", { headers: { "content-type": "text/calendar; charset=utf-8", "content-disposition": `inline; filename="beosztas.ics"`, "cache-control": "private, max-age=300" } });
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
    if (act === "notify") {
      const b = await request.json().catch(() => ({}));
      const title = b.test ? "🔔 Próba értesítés" : String(b.title || "").slice(0, 90), body = b.test ? "Így szól, ha jön az új havi beosztás, vagy változik a tiéd — koppints rá, és megnyílik a naptárad." : String(b.body || "").slice(0, 400);
      if (!title) return json({ ok: false, error: "nincs cím" }, 400);
      const L = (d.push || []).map(x => { try { return JSON.parse(x); } catch (e) { return null; } }).filter(Boolean);
      if (!L.length) return json({ ok: true, sent: 0, subs: 0 });
      /* rákattintva a naptár nyíljon meg, azon a napon: iPhone → Naptár app (a saját oldalon át, calshow:), máshol → Google Naptár */
      const day = /^\d{4}-\d{2}-\d{2}$/.test(String(b.d || "")) ? b.d : budaToday(), [yy, mm, dd] = day.split("-").map(Number);
      const subs = String(d.subAll || d.sub || "").split(","), gUrl = `https://calendar.google.com/calendar/r/day/${yy}/${mm}/${dd}`, aUrl = `${base}?open=cal&d=${day}`;
      const tag = b.test ? "fp-cal-test" : "fp-cal-" + Date.now();
      const res = await Promise.all(L.map(s => { const apple = /push\.apple\.com/i.test(s.endpoint), go = apple ? aUrl : (subs.includes("google") || !subs.includes("apple") ? gUrl : aUrl);
        return wpSend(sa, s, JSON.stringify({ title, body, url: go, tag }), url.origin).catch(() => 0); }));
      const keep = L.filter((s, i) => res[i] !== 404 && res[i] !== 410);
      if (keep.length !== L.length) await fsPatch(sa, path, { push: keep.map(x => JSON.stringify(x)), pushN: keep.length }).catch(() => {});
      return json({ ok: true, sent: res.filter(c => c >= 200 && c < 300).length, subs: keep.length, codes: res });
    }
    let vk = ""; try { vk = (await vapid(sa)).pub; } catch (e) {}
    return new Response(page({ name: d.name, ev: d.ev, base, ics: base + ".ics", web: base + ".ics", vapid: vk }), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" } });
  } catch (e) {
    return txt("Hiba: " + String((e && e.message) || e), 502);
  }
}
