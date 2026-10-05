// FirstPhone Munkaasztal — feliratkozható naptár (iPhone / Google Naptár)
// /naptar/<token>.ics → a Firestore „naptar/<token>” dokumentum ICS szövege
const PROJECT = "firstphone-munkaasztal";
const API_KEY = "AIzaSyA5RFVunlrXqX1NalKdQcbjUMoFhYCveM0"; // nyilvános webes Firebase kulcs (a weboldalban is benne van)

export async function onRequest({ params }) {
  const tok = String(params.token || "").replace(/\.ics$/i, "");
  if (!/^[A-Za-z0-9]{12,48}$/.test(tok)) return new Response("Nincs ilyen naptár.", { status: 404 });
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/naptar/${tok}?key=${API_KEY}`;
  const r = await fetch(url, { cf: { cacheTtl: 60 } });
  if (!r.ok) return new Response("Nincs ilyen naptár.", { status: 404 });
  const j = await r.json();
  const ics = j && j.fields && j.fields.ics && j.fields.ics.stringValue;
  if (!ics) return new Response("Nincs ilyen naptár.", { status: 404 });
  return new Response(ics, {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": 'inline; filename="FirstPhone_beosztas.ics"',
      "cache-control": "public, max-age=300",
      "access-control-allow-origin": "*",
    },
  });
}
