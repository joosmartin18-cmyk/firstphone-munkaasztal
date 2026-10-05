# FirstPhone Munkaasztal

Bolti munkaasztal: beosztás, cetli generátor, leltár, kassza, csomag nyilvántartó, selejt.

Weboldal: https://joosmartin18-cmyk.github.io/firstphone-munkaasztal/

Az adatok boltonként, belépés után a felhőben (Firebase) tárolódnak — a kódban nincs bolti adat.

## Admin végpont (`functions/api/admin.js`)
Cloudflare Pages Function — csak az `admin@admin.com` fiók hívhatja. Boltfiókok listája, új jelszó, letiltás/engedélyezés, fiók létrehozása.
Beállítás: Cloudflare → Pages projekt → Settings → Variables and Secrets → **Secret** `FIREBASE_SA` = a Firebase szolgáltatásfiók JSON kulcsa (Project settings → Service accounts → Generate new private key), majd új deploy.
