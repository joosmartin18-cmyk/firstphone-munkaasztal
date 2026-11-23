const { chromium } = require('playwright');
(async () => {
  const W = +process.env.W || 1366, H = +process.env.H || 800, O = process.env.O || '/tmp/d';
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: W, height: H } });
  await ctx.route(/gstatic\.com\/firebasejs|fonts\.(googleapis|gstatic)/, r => r.abort());
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://127.0.0.1:8765/index.html'); await p.evaluate(() => localStorage.setItem('valodi_adat', 'marad'));
  await p.goto('http://127.0.0.1:8765/index.html?proba=ujbolt'); await p.waitForTimeout(3000);
  const r = { login: await p.isVisible('#fcLogin'), demo: await p.evaluate(() => !!window.FP_DEMO) };
  await p.screenshot({ path: O + '-1.png' });
  await p.fill('#fcEmail', 'kaposvar'); await p.fill('#fcLogin input[type=password]', 'Egyszer123'); await p.press('#fcLogin input[type=password]', 'Enter');
  await p.waitForTimeout(1200); r.pw = await p.isVisible('#fpShopPw'); await p.screenshot({ path: O + '-2.png' });
  await p.fill('.sp-a', 'Bolt2026kap'); await p.fill('.sp-b', 'Bolt2026kap');
  await p.click('.sp-ck input[data-k=save]'); await p.click('.sp-ck input[data-k=paper]'); await p.waitForTimeout(300);
  await p.screenshot({ path: O + '-3.png', fullPage: false });
  r.goEnabled = await p.isEnabled('.sp-go'); await p.click('.sp-go'); await p.waitForTimeout(1500); await p.screenshot({ path: O + '-4.png' });
  await p.click('[data-p=next]'); await p.waitForTimeout(2500);
  r.setup = await p.evaluate(() => document.documentElement.classList.contains('fp-setup')); await p.screenshot({ path: O + '-5.png' });
  r.kilog = await p.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  if (process.env.FULL) {   // a bolt-beállítás végigkattintása
    await p.evaluate(() => { const t = [...document.querySelectorAll('#settingsPanel button, #settingsPanel [role=button], #settingsPanel .shop-card, #settingsPanel div')].find(x => /^Kaposvár TESCO/.test(x.textContent.trim()) && x.offsetParent && x.children.length < 6); t && t.click(); });
    for (let i = 0; i < 8; i++) {
      await p.waitForTimeout(500);
      await p.evaluate(() => { const ins = [...document.querySelectorAll('#settingsPanel input[type=text]')].filter(x => x.offsetParent && /név|nev|Dolgozó|dolgozó/i.test((x.placeholder || '') + (x.closest('label,div') || {}).textContent) && !x.value); if (ins[0]) { ins[0].value = 'Próba Elek'; ins[0].dispatchEvent(new Event('input', { bubbles: true })); ins[0].dispatchEvent(new Event('change', { bubbles: true })); } });
      const done = await p.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => x.offsetParent && /Mentés és alkalmazás/.test(x.textContent)); const n = [...document.querySelectorAll('button')].find(x => x.offsetParent && /^Tovább/.test(x.textContent.trim())); if (n) { n.click(); return 0; } if (b) { b.click(); return 1; } return 2; });
      if (done) break;
    }
    await p.waitForTimeout(2500); await p.screenshot({ path: O + '-6.png' });
    r.full = await p.evaluate(() => [!!window.fpCetliLocked && fpCetliLocked(), !!document.querySelector('.ps-lockc:not([hidden])'), document.documentElement.classList.contains('fp-setup'), (document.querySelector('#setErr') || {}).textContent || '']);
  }
  const p2 = await ctx.newPage(); await p2.goto('http://127.0.0.1:8765/index.html'); await p2.waitForTimeout(800);
  r.real = await p2.evaluate(() => [localStorage.getItem('valodi_adat'), !!localStorage.getItem('firstphone_last_login')]);
  console.log(JSON.stringify(r), 'hibák:', JSON.stringify(errs)); await b.close();
})();
