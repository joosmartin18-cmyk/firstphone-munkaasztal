// Szállítási címke — több rendelés egyben: két kitalált rendelést rögzít a „Kész → Igen, jöhet a következő” úton, aztán egyben „nyomtat” PDF-be.
// MIX=1: vegyesen (szállítási + megérkezett). Példa: POSTIT=1 N=2 O=/tmp/batch.pdf node tools/cetli-batch.js   (POSTIT nélkül: 62 mm-es szalag)
const { chromium } = require('playwright'); const fs = require('fs');
(async () => {
  const m = fs.readFileSync(__dirname + '/../index.html', 'utf8');
  const a = m.indexOf('<script type="text/plain" id="cetliDoc">') + '<script type="text/plain" id="cetliDoc">'.length;
  const doc = m.slice(a, m.indexOf('</script>', a)).replace(/<\\\/script/g, '</' + 'script');
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1366, height: 900 } });
  await ctx.route(/fonts\.(googleapis|gstatic)/, r => r.abort());
  await ctx.route('http://127.0.0.1:8765/__cetli.html', r => r.fulfill({ contentType: 'text/html; charset=utf-8', body: doc }));
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.addInitScript(([pi]) => { try { localStorage.setItem('firstphone_bz_skip', new Date().toDateString()); if (pi) localStorage.setItem('firstphone_cetli_mode', 'postit'); } catch (e) {} document.addEventListener('DOMContentLoaded', () => document.documentElement.classList.add('ui-uj')); }, [process.env.POSTIT || '']);
  await p.goto('http://127.0.0.1:8765/__cetli.html'); await p.waitForTimeout(1500);
  const info = await p.evaluate(async ([N, MIX]) => {
    const w = ms => new Promise(r => setTimeout(r, ms)), log = [];
    window.print = () => { log.push('PRINT'); };
    document.querySelectorAll('.modal-backdrop.show').forEach(x => x.classList.remove('show'));
    const set = (id, v) => { const e = document.getElementById(id); if (e) { e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); } };
    for (let i = 1; i <= N; i++) {
      const er = MIX && i % 2 === 0;   // MIX=1: minden második egy Megérkezett rendelés
      const tb = document.querySelector('.tab-btn[data-tab="' + (er ? 'erkezett' : 'szallitas') + '"]'); if (tb) tb.click(); await w(300);
      if (er) { set('e-order', 'S2000' + i); set('e-name', 'Minta Átvevő ' + i); try { products4.length = 0; addProduct4('Minta tok ' + i, 1, 4990, ''); renderProducts4(); updatePreview4(); } catch (e) { log.push('hiba:' + e.message); } }
      else { set('orderNum', 'S1000' + i); set('customer', 'Minta Vevő ' + i); set('atjel', '12' + i + '4'); set('route', 'KAPV-BUDD');
      try { products.length = 0; addProduct('Minta telefon ' + i + ' 128GB', 1, 99990 + i, 'FT10000' + i); renderProducts(); updatePreview(); } catch (e) { log.push('hiba:' + e.message); } }
      await w(300); log.push('gomb:' + document.getElementById('printBtn').textContent);
      document.getElementById('printBtn').click(); await w(400);
      const md = document.getElementById('sbModal'); log.push('ablak:' + md.classList.contains('show') + ' ' + md.querySelector('.sb-print').textContent);
      if (i < N) { md.querySelector('.sb-more').click(); await w(500); log.push('lista:' + document.getElementById('sbN').textContent + ' ürült:' + (document.getElementById('orderNum').value === '')); }
      else { md.querySelector('.sb-print').click(); await w(700); }
    }
    return log.join(' | ');
  }, [+(process.env.N || 2), !!process.env.MIX]);
  if (process.env.SHOT) await p.screenshot({ path: process.env.SHOT });
  await p.emulateMedia({ media: 'print' });
  await p.pdf({ path: process.env.O || '/tmp/batch.pdf', preferCSSPageSize: true, printBackground: true });
  console.log(info, 'hibák:', errs.slice(0, 3)); await b.close();
})();
