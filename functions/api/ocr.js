/* FirstPhone Munkaasztal — 🤖 AI szövegkiolvasás a lefotózott dokumentumokból (Cloudflare Pages Function + Workers AI)
   A képet NEM tároljuk itt: csak elküldjük a Cloudflare AI-nak, és visszaadjuk a kiolvasott szöveget.
     GET  /api/ocr            → { ok, ai }            (be van-e kapcsolva az AI — nem futtat semmit)
     GET  /api/ocr?test=1     → { ok, text, model }   (egy beépített kis próbaképpel kipróbálja; percenként 1×)
     POST /api/ocr  { img:"<base64 JPEG>", page, pages }   (Authorization: Bearer <Firebase idToken>)
       → { ok, title, text, model }
   Beállítás (egyszer, a Cloudflare-ben): Pages projekt → Settings → Bindings → Add → Workers AI → Variable name: AI */
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const enc = new TextEncoder();
const b64u = buf => { const a = new Uint8Array(buf); let s = ""; for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000)); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
const b64uStr = s => b64u(enc.encode(s));
let tokCache = null;
async function accessToken(sa) {
  if (tokCache && tokCache.exp > Date.now() + 60000) return tokCache.t;
  const now = Math.floor(Date.now() / 1000);
  const head = b64uStr(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const body = b64uStr(JSON.stringify({ iss: sa.client_email, scope: "https://www.googleapis.com/auth/identitytoolkit https://www.googleapis.com/auth/cloud-platform", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }));
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
/* csak belépett Munkaasztal-fiók használhatja (különben bárki elhasználhatná az AI-keretet) */
async function signedIn(sa, request) {
  const idToken = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!idToken) return false;
  const at = await accessToken(sa);
  const lr = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${sa.project_id}/accounts:lookup`, { method: "POST", headers: { authorization: "Bearer " + at, "content-type": "application/json" }, body: JSON.stringify({ idToken }) });
  const lj = await lr.json().catch(() => ({})); const me = (lj.users || [])[0];
  return !!(lr.ok && me && !me.disabled);
}
const SYS = "Pontos szövegfelismerő (OCR) vagy. A képen egy telefonnal lefotózott, kiegyenesített dokumentum van — többnyire magyar nyelvű (nyugta, átvételi elismervény, szerződés, szállítólevél, levél). "
  + "Írd le a dokumentum TELJES szövegét betűhűen, az eredeti sorrendben és sortörésekkel. Ne fordíts, ne foglalj össze, ne magyarázz, ne javíts ki és ne találj ki semmit. "
  + "A számokat (összegek, dátumok, IMEI, telefonszám, cikkszám, adószám) karakterre pontosan másold. A magyar ékezeteket (á é í ó ö ő ú ü ű) pontosan írd. "
  + "Táblázatnál soronként írd, a cellákat ' | ' jellel válaszd el. Ami nem olvasható, oda ezt írd: [olvashatatlan]. Kézírást is olvasd ki, ha lehet. Aláírás helyére: [aláírás], pecsét helyére: [pecsét: a pecsét szövege].";
const ASK = "Az első sorba írj egy rövid, tárgyszerű címet a dokumentumnak (legfeljebb 6 szó, pl. „Átvételi elismervény – iPhone 13”), így:\nCÍM: …\nUtána egy sorban: ---\nUtána a dokumentum teljes szövege.";
const MODELS = ["@cf/meta/llama-4-scout-17b-16e-instruct", "@cf/mistralai/mistral-small-3.1-24b-instruct", "@cf/google/gemma-3-12b-it"];
const pickText = r => { if (!r) return ""; if (typeof r === "string") return r; if (typeof r.response === "string") return r.response; if (r.result && typeof r.result.response === "string") return r.result.response;
  const c = r.choices && r.choices[0] && r.choices[0].message && r.choices[0].message.content; return typeof c === "string" ? c : Array.isArray(c) ? c.map(x => x.text || "").join("") : ""; };
async function readImg(ai, dataUrl) {
  let last = "";
  for (const model of MODELS) {
    try {
      const r = await ai.run(model, { messages: [{ role: "system", content: SYS }, { role: "user", content: [{ type: "text", text: ASK }, { type: "image_url", image_url: { url: dataUrl } }] }], max_tokens: 3000, temperature: 0 });
      const t = pickText(r).trim();
      if (t.length > 2) return { model, raw: t };
      last = "üres válasz (" + model + ")";
    } catch (e) { last = String((e && e.message) || e).slice(0, 300); }
  }
  throw new Error(last || "az AI nem válaszolt");
}
/* „CÍM: …\n---\nszöveg” szétszedése (ha a modell nem így írta, a teljes válasz a szöveg) */
function split(raw) {
  let t = raw.replace(/^```[a-z]*\s*|```\s*$/g, "").trim(), title = "";
  const m = t.match(/^\s*\**\s*C[ÍI]M\s*:\s*\**\s*(.+?)\s*\**\s*\n/i);
  if (m) { title = m[1].replace(/[„”"*]/g, "").trim().slice(0, 70); t = t.slice(m[0].length); }
  t = t.replace(/^\s*-{3,}\s*\n?/, "").trim();
  return { title, text: t };
}
const TEST = "data:image/png;base64,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";
let lastTest = 0;
export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  if (request.method === "GET") {
    if (!url.searchParams.get("test")) return json({ ok: true, ai: !!(env.AI && env.AI.run) });
    if (!(env.AI && env.AI.run)) return json({ ok: false, error: "noai" }, 503);
    if (Date.now() - lastTest < 60000) return json({ ok: false, error: "várj egy percet a következő próbáig" }, 429);
    lastTest = Date.now();
    try { const r = await readImg(env.AI, TEST); return json(Object.assign({ ok: true, model: r.model }, split(r.raw))); }
    catch (e) { return json({ ok: false, error: String((e && e.message) || e) }, 502); }
  }
  if (request.method !== "POST") return json({ ok: false, error: "POST kell" }, 405);
  if (!(env.AI && env.AI.run)) return json({ ok: false, error: "noai" }, 503);
  let sa; try { sa = JSON.parse(env.FIREBASE_SA || ""); } catch (e) { sa = null; }
  if (!sa || !sa.private_key) return json({ ok: false, error: "nosa" }, 503);
  try {
    if (!(await signedIn(sa, request))) return json({ ok: false, error: "nincs belépve" }, 401);
    const q = await request.json().catch(() => ({}));
    const img = String(q.img || "").replace(/^data:image\/[a-z]+;base64,/i, "");
    if (img.length < 200) return json({ ok: false, error: "nincs kép" }, 400);
    if (img.length > 2.6e6) return json({ ok: false, error: "túl nagy kép" }, 413);
    const r = await readImg(env.AI, "data:image/jpeg;base64," + img);
    return json(Object.assign({ ok: true, model: r.model }, split(r.raw)));
  } catch (e) {
    return json({ ok: false, error: String((e && e.message) || e) }, 502);
  }
}
