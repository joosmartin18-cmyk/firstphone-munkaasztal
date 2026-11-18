# FirstPhone Munkaasztal — útmutató Claude-nak

Bolti munkaasztal a FirstPhone üzleteknek: beosztás, cetli generátor, leltár, kassza, csomag, selejt, teendők, eladásegéd, tudástár, chat, admin felület.
Élesben: https://firstphone-munkaasztal.pages.dev — a `main` ág minden feltöltése azonnal kimegy (Cloudflare Pages). **Próbaoldal nincs**, minden változás egyenesen élesbe megy, ezért feltöltés előtt mindig tesztelj.

A tulajdonos (Martin) nem programozó: ő mondja meg, mit szeretne, te csinálod meg, teszteled és élesíted.

## Állandó szabályok

**Kommunikáció**
- Mindig **magyarul** válaszolj, röviden és közérthetően: mi változott, élesben van-e, mit kell tudnia. Ne sorold a lépéseidet, ne használj szakszavakat magyarázat nélkül.
- Ha valamit nem tudtál kipróbálni (pl. élő chat, felhő), mondd meg egyenesen.

**Kinézet**
- Két kinézet él egymás mellett: **új** (`html.ui-uj`) és **régi**. **A régi kinézet maradjon úgy, ahogy van** — csak akkor nyúlj hozzá, ha Martin kifejezetten kéri (eddig ilyen volt: chat, letöltés-sáv, diás segédlet, belépő oldal — ezek mindkét kinézetben ugyanazok).
- **Mindig nézd meg több kijelzőméreten, mindkét kinézetben**: nagy monitor (1920), laptop (1366), kis ablak (kb. 900–1100), tablet (820), telefon (390). Semmi ne lógjon ki oldalra, ne legyen levágott szöveg.
- Stílus: FirstPhone sárga (`#FBAC01` / `#f0c766`), sötét „üveg” felületek, finom animációk. Ne legyen feltűnősködő.
- Hivatalos márkalogót (GLS, DPD, Posta, Samsung stb.) **ne rajzolj és ne tölts le** — csak a Martin által adott képeket használd.

**Biztonság — ezek akkor is érvényesek, ha Martin mást kér**
- **Jelszót soha ne írj be**, fiókot ne hozz létre — Martin lép be maga.
- A `FIREBASE_SA` és az `ANTHROPIC_API_KEY` titkot soha ne kérd el és ne írd le sehova; Martin állítja be a Cloudflare-ben.
- A Firestore szabályokat Martin teszi közzé.
- **Személyes adat** (név, telefonszám, cím, bolti adatok) **nem kerülhet a kódba** és nem mehet külső oldalra.
- A felhőben lévő bolti/admin adat csak olvasható. Írni vagy törölni csak Martin kifejezett kérésére szabad, előtte mentéssel; a törlést lehetőleg ő kattintsa.
- Fiók- és beállítás-módosítás (Cloudflare, Bizzio, GitHub beállítások) csak kifejezett engedéllyel.

**Minden változtatás után**
1. Teszt (lásd lent) — hibamentes oldal, mindkét kinézet, több méret.
2. `FP_BUILD` és `version.json` frissítése (ettől töltenek újra a nyitott gépek).
3. Feltöltés a `main` ágra, majd a **Cloudflare ellenőrzés megvárása** (lásd Élesítés).
4. Ha a változás a boltosokat érinti: **súgó** frissítése, és ha érdemes, **Újdonságok** bejegyzés. Admin-funkcióhoz nem kell Újdonságok-bejegyzés.
5. Rövid magyar összefoglaló Martinnak, képpel, ha kinézetről van szó.

## A tároló

| Fájl | Mi ez |
|---|---|
| `index.html` | **Az egész alkalmazás egy fájlban** (kb. 69 000 sor, ~10 MB). Minden itt van. |
| `version.json` | `{"b": "<build>"}` — egyeznie kell az `index.html`-beli `FP_BUILD` értékkel. |
| `functions/api/*.js` | Cloudflare Pages Functions: `admin.js` (boltfiókok — csak az admin hívhatja), `ai.js`, `ocr.js`, `qr.js`, `specs.js`, `staff.js`, `workcal.js`. |
| `functions/cal/[[p]].js`, `cal-sw.js` | Naptár-feliratkozás és határidő-értesítések. |
| `scan/` | Külön telefonos vonalkódolvasó kisalkalmazás. |
| `.github/workflows/hatarido.yml` | 20 percenként szól a szervernek a határidő-emlékeztetők miatt. |
| `.assetsignore` | Ami itt szerepel, azt a Cloudflare nem teszi ki a weboldalra (ez a fájl és a `tools/` is itt van). |
| `tools/shot.js` | Gyors böngészős próba + képernyőkép (lásd Tesztelés). |
| `tools/admin-shot.js`, `tools/admin-all.sh` | Az **admin felület** helyi próbája belépés nélkül, ál-felhővel és kitalált boltokkal (`NAV=shops TH=light LK=old W=390 O=kep.png node tools/admin-shot.js`; az `admin-all.sh <mappa> [W H TH LK]` mind a 11 oldalt lefényképezi). |

## Tokentakarékos munkamód (fontos, a fájl óriási)

- **Soha ne olvasd be az egész `index.html`-t.** Keress: `grep -n "kulcsszó" index.html | cut -c1-200`, aztán csak a kellő sorokat: `sed -n 'A,Bp' index.html | cut -c1-400`. Sok sor több ezer karakter hosszú — mindig vágd `cut`-tal.
- **Szerkesztés Python cserével**, egy szkriptben több cserével, mindig ellenőrizve, hogy a keresett szöveg pontosan egyszer (vagy a várt számban) fordul elő:
  ```python
  m = open('index.html').read()
  assert m.count(a) == 1; m = m.replace(a, b)
  open('index.html', 'w').write(m)
  ```
- Parancskimenetet rövidítsd (`| tail -3`, `| head`, `| cut -c1-200`). Képernyőképet csak ha kell, kicsiben.
- Kis változásnál egy körben: szerkesztés → teszt → élesítés.

## Hogyan épül fel az index.html

Sorszámok helyett ezekre keress rá (a sorok folyamatosan csúsznak):

- `window.fpKapUj=function` — **ez dönti el, új vagy régi kinézet**: a bolt saját választása (`settings.uiLook` = `"old"`/`"new"`), Bonyhád alapból régi, mindenki más új. Kinézet-váltáskor az oldal újratölt (nem keveri a kettőt).
- `<style id="uiUjSkin">` — az új kinézet és a közös újabb részek CSS-e, `/* ===== PRÓBA N: ... */` megjegyzésekkel tagolva (pl. PRÓBA 26–27 üveg-kinézet, 28 chat, 29 belépő oldal). **Ez a blokk kétszer szerepel a fájlban**: egyszer a fő oldalon, egyszer a beágyazott Cetli-dokumentumban (`<script type="text/plain" id="cetliDoc">`). Ha a `uiUjSkin`-ben cserélsz, számíts 2 találatra, és mindkettőt cseréld.
- `function fpLayout()` — a régi kinézetben a menü helye: `settings.layout` = `"old"` (felül) / `"new"` (oldalt). Bonyhádnál alapból felül van, amíg ők mást nem választanak (`settings.layPick2`). Az új kinézetben a menü mindig oldalt van.
- `window.fpUiLookPick` / `function pick(first)` — a 🖥️ Kinézet választó (Új · Régi, menü oldalt · Régi, menü felül).
- `function login(msg)` — belépő oldal (`#fcLogin.lk`, „zárolt képernyő” stílus, PRÓBA 29 CSS). Belépéskor még nem tudni, melyik bolt az, ezért ez mindkét kinézetnél ugyanaz.
- `#fpBoot` — induláskor betöltőablak blokkol, amíg a felhő be nem tölt.
- `const TT_BOOKS` — a Tudástár tartalma (`sg` Segédlet, `kk` Kézikönyv, `sh` boltok). `window.ttSlides` / `<style id="ttsCss">` — a ▶ Diás segédlet, ami a fejezetek blokkjaiból magától épít animált diákat.
- `function keepScroll`, `function chatHtml`, `function drawMsgs`, `async function send` — bolti chat; `csGo` — admin chat. A `keepScroll` csak akkor rajzol újra, ha a tartalom változott, és csak az új üzenet animál (villogás ellen) — ezt ne rontsd el. Csatolmány: `att:{k:"img"|"file", d, n, s, t}`, legfeljebb ~700 KB.
- `var NEWS = [` — Újdonságok bejegyzések (`both:true` = mindkét kinézetben megjelenik). `id="thelpBody"` és a többi `help-slide` — súgók.
- `#fcAdmin.ax` — admin felület (`ax-` kezdetű osztályok). Boltválasztó: `storeList()`. Az admin **teljes kinézete** (sima „admin konzol”: színek, oldalmenü, felső sáv, gomb, mező, fül, kártya, felugró ablakok) egy helyen van: `function axUni()` — mindkét kinézetben ugyanaz. Ugyanitt `axEmoClean`: a díszítő emojikat kiszedi az admin felületről (chat, jegyszöveg, beviteli mező kivétel). **Admin v3** (Martin kérésére): a bolti új kinézet stílusában — meleg sötét háttér sárgás fényekkel, üvegkártyák (`--axBlur`, könnyített módban nincs), sárga színátmenetes aktív menüpont / fül / fő gomb, kapszula gombok, fejléc dátummal és sárga utolsó szóval (`axHeadFx`); ez a réteg az `axUni` CSS végén van, `#fcAdmin#fcAdmin#fcAdmin` előtaggal. Admin Beosztás: **Havi / Minden bolt** = boltonként kis havi naptár kártyán (`.sm2`, névvel, üres nap piros); **Munkaidő** = boltonként kártya, dolgozónként nagy óraszám + haladás-csík (`.wt2`), a beállítások a ⚙ mögött (`window.__wtOpen`). **Napi** = boltonként kártya (`.nd`, ki dolgozik, ki van bent most, napi csík a mostani idővel, elöl a „nincs beosztva”); **Ünnepnapok** = hónapok szerint, visszaszámlálással, a következő kiemelve, az elmúltak rejtve (`.hol2`, `window.__holPast`). A kereső (`.ax-scq`) **minden fülön** látszik és szűr (ünnepnapnál névre/hónapra). A menü alapból feliratos/rögzített (`fp_ax_nav2`) — új admin-elemnél a meglévő `ax-btn` / `ax-in` / `ax-seg` / `ax-card` / `ax-ch` osztályokat használd, ne írj külön stílust.
- `<style id="ltMaSkin">` (PRÓBA 30) + `function ltMaHead` — a **Leltár** új kinézete a kezdőlap stílusában (nagy fejléc, üvegkártyák rácsban); csak `html.ui-uj` alatt, a régi kinézet változatlan. Próba-export betöltése: `EV="$(cat tools/lt-demo.js)" PAGE=leltar node tools/shot.js`.
- Cetli post-it nyomtatás: `piAdjGet/piAdjStyle` — gépenkénti igazítás (eltolás mm, méret %), „📐 Nyomtatás igazítása” gomb. Nyomtatási próba PDF-be: `POSTIT=1 UJ=1 node tools/cetli-print.js`.
- Kezdőlap óra-kártya: `window.__maM` üzenetlista (váltás 6,5 mp-enként / kattintásra, `maMsgNext`), zárás után búcsú + holnapi kolléga; `<style id="maMsgCss">` (PRÓBA 31). Próba adott időpontra: `NOW='2026-11-16T21:00:00' SCH=same|other EMP2=1 node tools/shot.js`.
- **Több cetli egyben, vegyesen is** (minden cetlitípusnál): `SB` lista, `sbAsk / sbPrint / sbBar / sbClearTab` — a „✅ Kész” gomb után kérdez; a végén mind külön cetlire, „1/3 rendelés / cetli” jelöléssel. Próba: `MIX=1 POSTIT=1 N=3 node tools/cetli-batch.js`. A szállítási címke „Kiküldős” része (`#kkBox`) Martin kérésére el van rejtve.
- **Újdonságok animáció:** `NEWS_ANIM` + `newsAnim(n)`, `<style id="newsAnimCss">`. **Minden új NEWS-bejegyzéshez készíts saját, a témához illő animációt** (`anim:"kulcs"`); ha nincs, az azonosítóból választ egy általánosat (`NEWS_GEN`), így mindig más. Ha Martin azt írja, „mehet az újdonságokba”, azonnal készíts bejegyzést saját animációval. Próba: `KEEPNEWS=1 T=3300 node tools/shot.js`.
- `<style id="ksMaSkin">` + `<script id="ksMaJs">` (PRÓBA 32): **Kassza** a kezdőlap stílusában (fejléc állapot-chippel: megszámolva / egyezik / hiány / többlet); a **Cetli** fejléce és kártyái ugyanígy (a Cetli-dokumentum saját CSS-ében, `clHead`). Csak új kinézetben.
- `<style id="calClearCss">` + `<script id="calClearJs">` (PRÓBA 33): Beosztás naptár jól láthatóan (élénk dolgozói színek, a kártyák betűszíne a beállított marad); a méret-szabályok csak asztali nézetben (`:not(.m-app)`). Próba teli hónappal: `SCH=month EMP2=1 PAGE=beosztas node tools/shot.js`.
- Hangok: `window.fpSound(kind, vol)` (ok, done, dup, err, info, msg, send) — a **„zen”** hangcsomag (Martin választása; `zen()` segéd). Próbaoldalhoz a hangokat külön HTML-ben érdemes megmutatni.
- **Teendők:** saját kis naptár a határidőhöz (`calH`, `TDF.cal` / `TDE.cal`; a rejtett `<input type=date>` kattintásra sok böngészőben nem nyílt meg). Új kinézet: `<style id="tdMaSkin">` + `<script id="tdMaJs">` (PRÓBA 34). Próba-teendőkkel: `TODO=1 PAGE=teendo node tools/shot.js`.
- **Simább futás:** `<style id="perfCss">` (olcsóbb elmosás `--gl-blur`, könnyített módban elmosás és végtelen díszítő animációk nélkül). A lassúság fő oka a mozgó háttér + üvegelmosás együtt. `fpWeakGuess`: 4 szálas vagy kisebb gép mindig könnyített; `fpWatch` használat közben is mér, és akadozásnál átvált. Új díszítő animációnál mindig legyen `html.fp-lite` alatti kikapcsolás. Az Újdonságok kis animációi könnyített módban is mennek (`html.fp-lite :is(.ui-news-anim, #_na) *` — az id-s `:is` kell, mert a régi lite-szabály nagyon erős). Az animáció **mindig automatikus** (`fpAnimPref()` = "auto"); a kézi ✨/⚡ gomb (`#animToggle`) Martin kérésére megszűnt — ne tedd vissza.
- `fpBrkNote()` — a munkaközi szünet (6 óra felett 1 óra) szövege; **nyomtatványonként csak egyszer, lábjegyzetként** szerepeljen.
- `const FEATS`, `function fpApplyFeats()` — boltonként ki-bekapcsolható programok. Az admin kikapcsolása (`firstphone_admin_cfg`, `admOff`) az új kinézetben is rejtse a menügombot (`#pageSwitch .ps-btn.ps-off` — a `perfCss` elején) és a kezdőlap gombjait/kártyáit (`maRender` végén). Admin bolt-adatlap → Beállítások: „Mit lát ez a bolt?” (`.ds2`, `dsDraw`), Speckó csak Kaposvárnál. **Wolt cetli** csak ahol van Wolt: admin „Mit lát ez a bolt?” → Wolt cetli kapcsoló (`appC.wolt`, Kaposváron alapból be; bolt oldalon `woltOn`, a Cetli keretben `ft-off-wolt`). A Kiküldős megszűnt (súgóból, adminból kivéve). Boltok táblázat **Kinézet** oszlop + adatlap-címke (`lookOf`, `lookH`: Új / Régi · menü felül/oldalt, „alap” ha a bolt még nem választott). **Belépő oldal** könnyítve: álló háttér (nincs elmosott mozgó folt), nincs üvegelmosás, könnyített módban a két oldali bemutató-kártyák rejtve (`perfCss` eleje). Lassú-gép mérés: `CPU=6 NOUSER=1 EV="<fps mérés>" node tools/admin-shot.js`.
- **Súgók és Újdonságok diasorként** (PRÓBA 35, `<style id="hsDiaCss">` + `<script id="hsDiaJs">`, a ▶ Diás segédlet `ttsCss` keretét használja): `fpDiaFromHelp(win, modal, slides, at)` a `makeHelp` súgó-ablak diáiból (`help-slide`: cím, `hc-wrap` animáció, `hs-steps` / `tips`) teljes képernyős, magától lapozó diasort épít; a régi `.help-modal` már csak tartalék/forrás. A Cetli súgó a keretből a szülő `fpDiaFromHelp`-jét hívja (a CSS-t bemásolja a keretbe). A diák bal oldalán **nem a régi súgó-jelenetek** futnak (Martin kérése), hanem lépésenként a lépés szövegéből épülő új jelenet (`hxScene`/`hxKind`: tap, type, pick, check, print, dl, scan, cal, tip, info; a `<b>` kiemelésekből veszi a feliratot), ami a kiemelt lépéssel együtt vált; az animációs doboz `sticky`, görgetéskor is látszik. Újdonságok: `fpDia({...})` — az összes még nem látott bejegyzés egy diasorban, bezáráskor mind „látott”. Új súgó-lépésnél a lényeges szót tedd `<b>`-be — abból lesz a jelenet felirata. Próba: `NEWS=2 KEEPNEWS=1 node tools/shot.js` (a legutóbbi N újdonság látatlan).
- Admin **Hibajegyek v2**: állapot szerint csoportosított jegy-kártyák (`.tk2`, `drawTix`), részleteknél folyamat-sáv (`.tk2-step`, kattintható `data-tst`) és buborék (`.tk2-msg`). Admin **Fiókok v2**: kártyás rács (`.fc-pw-r.pw2`, `pwPanel`). Próbához az `admin-shot.js` ál-választ ad az `/api/admin` hívásra. CSS: `axUni` vége.
- **Közlemény v2**: a bolti kártya és az admin előnézet ugyanaz a `msgCard(m, prev)` (`.fcm2`, `#fcMsg.fcm2-w`, CSS a `fpCloudCss`-ben; típus: info/warn/ok, lejárat-chip). Admin: típusválasztó csempék (`.ax-seg.ml2`), kint lévő közlemények kártyán (`.mi2`: címzett-monogramok, lejárat-csík). Bolti próba: `EV` → `localStorage firstphone_admin_msg` + `fpShowAdminMsg()`.
- **Megérkezett rendelés** határideje 5 munkanap (hétvége nélkül, `erkDateToStr`); a foglaló marad 5 nap (`dateToStr`).
- **Felső sáv v2** (PRÓBA 36, `<style id="hdrV2Css">` + `<script id="hdrV2Js">` a `</body>` előtt; új kinézet, asztali nézet): a `.hdr2` tömör (nem átlátszó, könnyített módban is olvasható), lebegő sáv; cím + alcím egymás alatt, „Ki dolgozik” chip jobbra; a `#fpTools` gombsort a JS a sávon belül, középre igazítja (`.hv2`, top/right). A régi kinézet és a telefon (`m-app`) változatlan.
- **Rendelés v2** (PRÓBA 37, `<style id="orV2Css">` a `</body>` előtt; új kinézet, asztali nézet): `renderOrders` markupja változatlan, csak CSS — állapot-folyamat (Rendelni kell › Megrendelve › Megjött, színes számláló), tömör ShieldUp-rács, egyszerű kereső/mezők. Próba tételekkel: `ORD=1 PAGE=teendo EV='document.querySelector("#tdTabs [data-tab=rend]").click()' node tools/shot.js`.
- **Selejt v2** (PRÓBA 38, `<style id="sxV2Css">` a `</body>` előtt; új kinézet, asztali nézet, csak CSS): a „Mai összesítő” dupla számai rejtve → vékony „napi cetli” sáv; tételek kártyán színes bal csíkkal (piros selejt / kék ShieldUp), jól látható gombok; tiszta űrlap-fejléc; 1180 px alatt egy oszlop (`.sx-main/.sx-side` display:contents + order). Próba tételekkel: `SX=1 PAGE=selejt node tools/shot.js`.
- Telefonos nézet: `html.m-app`.

**Adatok:** helyben `localStorage` (`firstphone_beosztas_tervezo_v2` a fő állapot, benne `settings`), felhőben Firestore `boltok/{uid}/kv/{kulcs}` → `{v, parts, by, t, n}`; törlés: `{del:true, v:null, parts:0}`; adminból írva `by:"admin"`. Boltok közti chat: `dm/{szoba}/m`.

**Buktatók, amikbe már belefutottunk**
- Új-kinézetes CSS ne írja felül a `@media print` elrejtéseket (emiatt volt post-it nyomtatási hiba).
- Az üveg-kinézet általános szabályai (`html.ui-uj ...`) sok mindent felülírnak — új ablaknál/gombnál erősebb szelektor és gyakran `!important` kell, különben áttetsző vagy rossz színű lesz.
- `prefers-reduced-motion` (a gépen „animációk csökkentése”): ilyenkor se tűnjön el és se csússzon egymásra semmi; `html.fp-anim-full` esetén teljes animáció kell.
- Régebbi Safari miatt ne használj regex lookbehindot.
- Régi kinézetben is lehet oldalsó menü — a „régi” nem azt jelenti, hogy felül van a menü.

## Tesztelés

```bash
python3 -m http.server 8765 --bind 127.0.0.1 &        # a tároló gyökeréből
LOC=Kaposvár LK=new W=1366 H=800 O=/tmp/a.png node tools/shot.js
LOC=Bonyhád LK=old PAGE=tudastar W=390 H=844 O=/tmp/b.png node tools/shot.js
```
A szkript felhő nélkül, próbaadatokkal nyitja meg az oldalt, kiírja a JavaScript-hibákat és azt, hogy kilóg-e valami oldalra (`kilog`), és képet ment. `EV='...'` változóval tetszőleges kódot futtathatsz az oldalon (kattintás, mérés). Minimum minden változásnál: `LK=new` és `LK=old`, asztali és telefonos méret, hibák listája üres.

Amit így **nem** lehet kipróbálni (belépés, felhő, élő chat, admin): írd meg Martinnak, hogy ezt élesben ő nézze meg, vagy kérd, hogy lépjen be a böngészőben.

## Élesítés

```bash
set -e
git checkout -q main && git pull -q --ff-only origin main
B=$(TZ=Europe/Budapest date +%Y%m%d-%H%M%S)
sed -i -E "s/window\.FP_BUILD=\"[0-9-]+\"/window.FP_BUILD=\"$B\"/" index.html
printf '{"b": "%s"}\n' "$B" > version.json
git add -A && git commit -qm "<rövid magyar leírás>" && git push -q origin main
H=$(git rev-parse HEAD)
until gh api repos/joosmartin18-cmyk/firstphone-munkaasztal/commits/$H/check-runs \
  --jq '.check_runs[]|select(.name|test("Cloudflare"))|.status' | grep -q completed; do sleep 8; done
gh api repos/joosmartin18-cmyk/firstphone-munkaasztal/commits/$H/check-runs \
  --jq '.check_runs[]|select(.name|test("Cloudflare"))|.conclusion'      # "success" kell legyen
```
Ha a Cloudflare ellenőrzés nem `success`, szólj Martinnak, és javítsd, mielőtt bármi mást csinálsz.

## Hibajegyek, közlemények

A boltok az alkalmazásból küldenek hibajegyet (🐞); ezek az admin felületen látszanak (Hibajegyek, Közlemények). Olvasni és megválaszolni csak úgy lehet, ha Martin be van lépve adminként a böngészőben — te ne lépj be helyette.
