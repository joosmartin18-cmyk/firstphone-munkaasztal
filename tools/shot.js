// Gyors helyi próba böngészőben (Playwright): megnyitja az index.html-t felhő nélkül, egy bolt nevében, és képet készít.
// Előtte:  python3 -m http.server 8765 --bind 127.0.0.1   (a tároló gyökeréből)
// Példa:   LOC=Bonyhád LK=old W=1366 H=800 O=/tmp/kep.png node tools/shot.js
//          LK=new PAGE=tudastar W=390 H=844 node tools/shot.js
// TODO=1: próba-teendők. KEEPNEWS=1: az Újdonságok ablak maradjon. EMP2=1: két dolgozó. SCH=same|other|month (egész hónap kitöltve)|year (az év eleje óta minden nap): ma A dolgozik, holnap ugyanő / B. NOW='2026-11-16T21:00': rögzített idő. Változók: LOC (bolt neve), LK (new|old|none = a bolt választott kinézete), LAY (old|new = régi kinézetben menü felül|oldalt),
//           PAGE (beosztas, cetli, leltar, kassza, csomag, selejt, teendo, elado, tudastar), W, H, O (kimenet), EV (lefuttatandó JS kifejezés), T (várakozás ms)
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const W = +process.env.W || 1366, H = +process.env.H || 800, LOC = process.env.LOC || 'Kaposvár', LK = process.env.LK || 'new';
  const ctx = await b.newContext({ viewport: { width: W, height: H }, isMobile: W < 500, hasTouch: W < 500, reducedMotion: process.env.RM ? 'reduce' : 'no-preference' });
  await ctx.route(/fonts\.(googleapis|gstatic)|gstatic\.com\/firebasejs/, r => r.abort());   // felhő és külső betűk nélkül
  if (process.env.PDFJS) await ctx.route(/pdf(\.worker)?\.min\.js/, r => { const w = /worker/.test(r.request().url()); r.fulfill({ status:200, contentType:'application/javascript', body:require('fs').readFileSync(process.env.PDFJS + (w ? '/build/pdf.worker.min.js' : '/build/pdf.min.js')) }); });
  await ctx.addInitScript(([loc, lk, lay, emp2, schd, todo, news, ord, sx, sk, fresh, guide]) => {
    if (sessionStorage.x) return; sessionStorage.x = 1;
    const s = { configured: true, location: loc, employees: [{ id: 'a', name: 'Teszt Elek Hosszúnevű', hex: '#a78bfa' }].concat(emp2 ? [{ id: 'b', name: 'Minta Béla Ferenc', hex: '#2a5bd7' }] : []), hours: Array(7).fill({ open: '09:00', close: '20:00' }) };
    if (lk) s.uiLook = lk; if (lay) s.layout = lay;
    const d = new Date();
    const sch = {}; if (schd === 'year') { const T = ['a', 'b', 'split', 'a', 'b', 'multi', 'a']; const s0 = new Date(d.getFullYear(), 0, 1); for (let x = new Date(s0); x <= d; x.setDate(x.getDate() + 1)) { if (x.getDay() === 0 && x.getDate() % 2) continue; const t = T[(x.getDate() + x.getMonth()) % 7]; sch[x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0')] = t === 'split' ? { type: 'split', am: 'a', pm: 'b' } : t === 'multi' ? { type: 'multi', full: ['a', 'b'], am: [], pm: [] } : { type: t }; } } else if (schd === 'month') { const T = ['a', 'b', 'split', 'multi', 'a', 'b', 'a']; for (let k = 1; k <= 28; k++) { if (k % 7 === 0) continue; const t = T[k % 7]; sch[d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(k).padStart(2, '0')] = t === 'split' ? { type: 'split', am: 'a', pm: 'b' } : t === 'multi' ? { type: 'multi', full: ['a', 'b'], am: [], pm: [] } : { type: t }; } } else if (schd) { const k = x => x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); const t = new Date(d); sch[k(t)] = { type: 'a' }; t.setDate(t.getDate() + 1); sch[k(t)] = { type: schd === 'same' ? 'a' : 'b' }; }
    const tds = []; if (todo) { const k = n => { const x = new Date(d); x.setDate(x.getDate() + n); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };
      [['Kirakat rendezése', 'all', k(0)], ['ShieldUp feltöltés', 'a', k(0)], ['Rendelés leadása', 'all', k(-2)], ['Leltár előkészítése', 'a', k(4)], ['Polcok portalanítása', 'all', null]].forEach((x, i) => tds.push({ id: 't' + i, text: x[0], who: x[1], due: x[2], done: {}, t: Date.now() - i })); }
    const ords = ord ? [['su','125 micron','','',3,'need',''],['su','160 micron - tablet','','',null,'need','vevő kérte'],['glass','Privacy','','iPhone 16 Pro',2,'need',''],['case','Könyvtok','Spigen','Samsung Galaxy A56',1,'need','fekete'],['acc','USB-C kábel','2 m','',5,'need',''],['acc','Töltőfej','20 W','',null,'ord',''],['su','gél','','',2,'ord',''],['glass','Sima üveg','','iPhone 15',4,'got','']].map((x, i) => ({ id: 'o' + i, cat: x[0], type: x[1], name: x[2], model: x[3], qty: x[4], st: x[5], note: x[6], t: Date.now() - i * 36e5, stAt: Date.now() - i * 18e5 })) : [];
    if (fresh) s.configured = false;
    localStorage.setItem('firstphone_beosztas_tervezo_v2', JSON.stringify({ year: d.getFullYear(), month: d.getMonth() + 1, schedule: sch, settings: s, todos: tds, orders: ords }));
    if (sk) { const R = (k, v) => ({ k, v, on: true });
      const cards = [['Samsung Galaxy S26', '123456', '', ''], ['iPhone 16 128GB', '349990', '', ''], ['Xiaomi Redmi Note 14 Pro', '119990', '', 'ÚJ'], ['Samsung Galaxy S25 Ultra 12/512GB', '549990', '', ''], ['Motorola Moto G85 5G', '89990', '99990', ''], ['iPhone 15 128GB', '279990', '', ''], ['Google Pixel 9a', '199990', '', ''], ['Nokia G42 5G', '64990', '', '']].map((x, i) => ({ id: 'k' + i, name: x[0], price: x[1], oldPrice: x[2], badge: x[3], note: i === 1 ? '2 év garancia' : '',
        rows: i === 0 ? [R('kijelzo', 'Dynamic LTPO AMOLED 2X, 120 Hz'), R('meret', '6.3" · 1080 × 2340'), R('cpu', '8 magos, Snapdragon 8 Elite Gen 5 - US/CA/CN Exynos 2600 - ROW'), R('kamera', '50+10+12 MP · előlap 12 MP'), R('akku', 'Li-Ion 4300 mAh'), R('tarhely', '128 GB · 12 GB RAM'), R('halo5g', '5G'), R('nfc', 'NFC – érintéses fizetés'), R('viz', 'IP68 por- és vízálló'), R('toltes', '25W vezetékes, 15W vezeték nélküli töltés')] : [R('kijelzo', '6,7" Super AMOLED, 120 Hz'), R('cpu', 'Exynos 1580, 8 mag'), R('tarhely', '256 GB tárhely, 8 GB RAM'), R('kamera', '50 MP + 12 MP + 5 MP'), R('akku', '5000 mAh'), R('toltes', '45 W gyorstöltés'), R('halo5g', '5G'), R('viz', 'IP67 por- és vízálló'), R('os', 'Android 15'), R('suly', '198 g'), R('szin', 'Színek: fekete, kék')] }));
      localStorage.setItem('firstphone_specko', JSON.stringify({ cards, set: {} }));
      const lg = t => 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="160"><text x="300" y="115" font-family="Arial" font-weight="900" font-size="110" text-anchor="middle" fill="#1428a0">' + t + '</text></svg>');
      localStorage.setItem('firstphone_specko_logos', JSON.stringify([{ id: 'l1', key: 'samsung', name: 'MÁRKA A', data: lg('MÁRKA A') }, { id: 'l2', key: 'iphone', name: 'MÁRKA B', data: lg('MÁRKA B') }])); }
    if (sx) { const tk = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      const it = [['iPhone 15 tok (sérült)', '5999123456789', 1, 'Sérült', 'x'], ['Samsung A56 üvegfólia', '5999000111222', 2, 'Törött', 'x'], ['ShieldUp 125 micron', '', 3, 'Hibás', 'su'], ['USB-C kábel 1 m', '5990011223344', 1, 'Csomagolás sérült', 'x'], ['ShieldUp gél', '', 1, '', 'su']].map((x, i) => ({ id: 'sx' + i, date: tk, time: String(9 + i).padStart(2, '0') + ':1' + i, name: x[0], code: x[1], qty: x[2], reason: x[3], by: 'Teszt Elek', kind: x[4] }));
      localStorage.setItem('firstphone_selejt', JSON.stringify({ items: it, lastBy: 'Teszt Elek', imp2026: true })); }
    localStorage.setItem('firstphone_welcome_seen', '1');
    if (!guide) { localStorage.setItem('fp_guide_full', '1'); localStorage.setItem('fp_guide_seen', JSON.stringify({ ma:1, beosztas:1, cetli:1, leltar:1, kassza:1, csomag:1, selejt:1, teendo:1, rendeles:1, tudastar:1, elado:1, specko:1 })); }
    localStorage.setItem('firstphone_cloud_off', '1');
    { const NS = ['uj-kinezet-2026-11', 'uj-kinezet-2026-11-09', 'frissites-2026-11-15', 'tudastar-diak-2026-11-15', 'cetli-szallitas-2026-11-16', 'cetli-tobb-egyben-2026-11-16', 'zen-hangok-2026-11-16', 'teendok-uj-2026-11-16', 'sugo-diak-2026-11-16', 'dolgozoi-kedvezmeny-2026-11-19', 'leltar-ket-export-2026-11-20']; localStorage.setItem('fp_ui_news_seen', JSON.stringify(NS.slice(0, NS.length - (+news || 0)))); }
  }, [LOC, LK === 'none' ? '' : LK, process.env.LAY || '', process.env.EMP2 || '', process.env.SCH || '', process.env.TODO || '', process.env.NEWS || '', process.env.ORD || '', process.env.SX || '', process.env.SK || '', process.env.FRESH || '', process.env.GUIDE || '']);
  if (process.env.NOW && ctx.clock) await ctx.clock.install({ time: new Date(process.env.NOW) });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://127.0.0.1:8765/index.html'); await p.mouse.move(W - 5, H - 5); await p.waitForTimeout(3500);
  const r = await p.evaluate(async ([pg, ev, keep]) => {
    document.querySelectorAll('.ui-thback,.set-hint,.ulk-back' + (keep ? '' : ',.ui-newsback')).forEach(x => x.remove());
    if (pg) { const x = document.querySelector('.ps-btn[data-page="' + pg + '"]'); if (x) x.click(); await new Promise(r => setTimeout(r, 1200)); }
    const o = { login: !!document.getElementById('fcLogin'), ujKinezet: document.documentElement.classList.contains('ui-uj'), body: document.body.className, kilog: document.documentElement.scrollWidth > innerWidth };
    if (ev) o.ev = await eval(ev);
    return JSON.stringify(o);
  }, [process.env.PAGE || '', process.env.EV || '', process.env.KEEPNEWS || '']);
  await p.waitForTimeout(+process.env.T || 500);
  await p.screenshot({ path: process.env.O || '/tmp/shot.png' });
  console.log(r, 'hibák:', errs.slice(0, 5)); await b.close();
})();
