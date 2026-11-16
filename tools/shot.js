// Gyors helyi próba böngészőben (Playwright): megnyitja az index.html-t felhő nélkül, egy bolt nevében, és képet készít.
// Előtte:  python3 -m http.server 8765 --bind 127.0.0.1   (a tároló gyökeréből)
// Példa:   LOC=Bonyhád LK=old W=1366 H=800 O=/tmp/kep.png node tools/shot.js
//          LK=new PAGE=tudastar W=390 H=844 node tools/shot.js
// Változók: LOC (bolt neve), LK (new|old|none = a bolt választott kinézete), LAY (old|new = régi kinézetben menü felül|oldalt),
//           PAGE (beosztas, cetli, leltar, kassza, csomag, selejt, teendo, elado, tudastar), W, H, O (kimenet), EV (lefuttatandó JS kifejezés), T (várakozás ms)
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const W = +process.env.W || 1366, H = +process.env.H || 800, LOC = process.env.LOC || 'Kaposvár', LK = process.env.LK || 'new';
  const ctx = await b.newContext({ viewport: { width: W, height: H }, isMobile: W < 500, hasTouch: W < 500, reducedMotion: process.env.RM ? 'reduce' : 'no-preference' });
  await ctx.route(/fonts\.(googleapis|gstatic)|gstatic\.com\/firebasejs/, r => r.abort());   // felhő és külső betűk nélkül
  await ctx.addInitScript(([loc, lk, lay]) => {
    if (sessionStorage.x) return; sessionStorage.x = 1;
    const s = { configured: true, location: loc, employees: [{ id: 'a', name: 'Teszt Elek', hex: '#a78bfa' }], hours: Array(7).fill({ open: '09:00', close: '20:00' }) };
    if (lk) s.uiLook = lk; if (lay) s.layout = lay;
    const d = new Date();
    localStorage.setItem('firstphone_beosztas_tervezo_v2', JSON.stringify({ year: d.getFullYear(), month: d.getMonth() + 1, schedule: {}, settings: s }));
    localStorage.setItem('firstphone_welcome_seen', '1');
    localStorage.setItem('firstphone_cloud_off', '1');
    localStorage.setItem('fp_ui_news_seen', JSON.stringify(['uj-kinezet-2026-11', 'uj-kinezet-2026-11-09', 'frissites-2026-11-15', 'tudastar-diak-2026-11-15']));
  }, [LOC, LK === 'none' ? '' : LK, process.env.LAY || '']);
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://127.0.0.1:8765/index.html'); await p.mouse.move(W - 5, H - 5); await p.waitForTimeout(3500);
  const r = await p.evaluate(async ([pg, ev]) => {
    document.querySelectorAll('.ui-thback,.set-hint,.ui-newsback,.ulk-back').forEach(x => x.remove());
    if (pg) { const x = document.querySelector('.ps-btn[data-page="' + pg + '"]'); if (x) x.click(); await new Promise(r => setTimeout(r, 1200)); }
    const o = { login: !!document.getElementById('fcLogin'), ujKinezet: document.documentElement.classList.contains('ui-uj'), body: document.body.className, kilog: document.documentElement.scrollWidth > innerWidth };
    if (ev) o.ev = await eval(ev);
    return JSON.stringify(o);
  }, [process.env.PAGE || '', process.env.EV || '']);
  await p.waitForTimeout(+process.env.T || 500);
  await p.screenshot({ path: process.env.O || '/tmp/shot.png' });
  console.log(r, 'hibák:', errs.slice(0, 5)); await b.close();
})();
