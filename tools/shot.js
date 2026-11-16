// Gyors helyi próba böngészőben (Playwright): megnyitja az index.html-t felhő nélkül, egy bolt nevében, és képet készít.
// Előtte:  python3 -m http.server 8765 --bind 127.0.0.1   (a tároló gyökeréből)
// Példa:   LOC=Bonyhád LK=old W=1366 H=800 O=/tmp/kep.png node tools/shot.js
//          LK=new PAGE=tudastar W=390 H=844 node tools/shot.js
// KEEPNEWS=1: az Újdonságok ablak maradjon. EMP2=1: két dolgozó. SCH=same|other: ma A dolgozik, holnap ugyanő / B. NOW='2026-11-16T21:00': rögzített idő. Változók: LOC (bolt neve), LK (new|old|none = a bolt választott kinézete), LAY (old|new = régi kinézetben menü felül|oldalt),
//           PAGE (beosztas, cetli, leltar, kassza, csomag, selejt, teendo, elado, tudastar), W, H, O (kimenet), EV (lefuttatandó JS kifejezés), T (várakozás ms)
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const W = +process.env.W || 1366, H = +process.env.H || 800, LOC = process.env.LOC || 'Kaposvár', LK = process.env.LK || 'new';
  const ctx = await b.newContext({ viewport: { width: W, height: H }, isMobile: W < 500, hasTouch: W < 500, reducedMotion: process.env.RM ? 'reduce' : 'no-preference' });
  await ctx.route(/fonts\.(googleapis|gstatic)|gstatic\.com\/firebasejs/, r => r.abort());   // felhő és külső betűk nélkül
  await ctx.addInitScript(([loc, lk, lay, emp2, schd]) => {
    if (sessionStorage.x) return; sessionStorage.x = 1;
    const s = { configured: true, location: loc, employees: [{ id: 'a', name: 'Teszt Elek Hosszúnevű', hex: '#a78bfa' }].concat(emp2 ? [{ id: 'b', name: 'Minta Béla Ferenc', hex: '#2a5bd7' }] : []), hours: Array(7).fill({ open: '09:00', close: '20:00' }) };
    if (lk) s.uiLook = lk; if (lay) s.layout = lay;
    const d = new Date();
    const sch = {}; if (schd) { const k = x => x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); const t = new Date(d); sch[k(t)] = { type: 'a' }; t.setDate(t.getDate() + 1); sch[k(t)] = { type: schd === 'same' ? 'a' : 'b' }; }
    localStorage.setItem('firstphone_beosztas_tervezo_v2', JSON.stringify({ year: d.getFullYear(), month: d.getMonth() + 1, schedule: sch, settings: s }));
    localStorage.setItem('firstphone_welcome_seen', '1');
    localStorage.setItem('firstphone_cloud_off', '1');
    localStorage.setItem('fp_ui_news_seen', JSON.stringify(['uj-kinezet-2026-11', 'uj-kinezet-2026-11-09', 'frissites-2026-11-15', 'tudastar-diak-2026-11-15', 'cetli-szallitas-2026-11-16']));
  }, [LOC, LK === 'none' ? '' : LK, process.env.LAY || '', process.env.EMP2 || '', process.env.SCH || '']);
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
