// Cetli nyomtatási próba: a beágyazott Cetli-dokumentumot önállóan megnyitja, kitalált adatokkal kitölti, és PDF-be „nyomtatja” (mint a böngésző nyomtatása).
// ADJ='{"x":-3,"y":-2,"s":92}': post-it igazítás. POSTIT=1: 75×75 mm-es post-it mód (A4-re nyomtat). Példa: TAB=erkezett O=/tmp/cetli.pdf node tools/cetli-print.js   (utána: pdftoppm -png -r 200 /tmp/cetli.pdf /tmp/cetli)
const { chromium } = require('playwright'); const fs = require('fs');
(async () => {
  const m = fs.readFileSync(__dirname + '/../index.html', 'utf8');
  const a = m.indexOf('<script type="text/plain" id="cetliDoc">') + '<script type="text/plain" id="cetliDoc">'.length;
  const doc = m.slice(a, m.indexOf('</script>', a)).replace(/<\\\/script/g, '</' + 'script');
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1366, height: 900 } });
  if (!process.env.FONTS) await ctx.route(/fonts\.(googleapis|gstatic)/, r => r.abort());
  await ctx.route('http://127.0.0.1:8765/__cetli.html', r => r.fulfill({ contentType: 'text/html; charset=utf-8', body: doc }));
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  if (process.env.POSTIT) await p.addInitScript(() => { try { localStorage.setItem('firstphone_cetli_mode', 'postit'); } catch (e) {} });
  if (process.env.ADJ) await p.addInitScript((v) => { try { localStorage.setItem('firstphone_pi_adj', v); } catch (e) {} }, process.env.ADJ);
  if (process.env.LOGO) await p.addInitScript((v) => { window.__logo = v; }, process.env.LOGO);   // LOGO='színes_szél,magas,fekete_szél,magas' — próbalogó
  if (process.env.SHIP) await p.addInitScript((v) => { window.__ship = v; }, process.env.SHIP);   // SHIP=1990: szállítási költség
  if (process.env.UJ) await p.addInitScript(() => { window.__uj = 1; document.addEventListener('DOMContentLoaded', () => document.documentElement.classList.add('ui-uj')); });
  await p.goto('http://127.0.0.1:8765/__cetli.html'); await p.waitForTimeout(1500);
  const info = await p.evaluate(async ([tab, process_env_PROD]) => {
    const t = document.querySelector('.tab-btn[data-tab="' + tab + '"]'); if (t) t.click(); await new Promise(r => setTimeout(r, 400));
    if (window.__logo) { const mk = (w, h, t) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); x.fillStyle = '#000'; x.font = 'bold ' + Math.round(h * .45) + 'px sans-serif'; x.fillText(t, 4, h * .6); return c.toDataURL('image/png'); };
      const L = window.__logo.split(','); applyLogo(mk(+L[2], +L[3], 'FirstPhone B'), mk(+L[0], +L[1], 'FirstPhone C')); await new Promise(r => setTimeout(r, 600)); }
    const set = (id, v) => { const e = document.getElementById(id); if (e) { e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); } };
    set('e-order', 'S10099'); set('e-name', 'Minta Vásárló Hosszúnevű'); set('e-phone', '+36 30 000 0000'); set('e-email', 'nagyonhosszu.minta.cim21@peldaemail.com');
    if (window.__ship) { document.querySelector('#e-shipKind [data-s="1"]').click(); const si = document.getElementById('e-ship'); si.value = window.__ship; si.dispatchEvent(new Event('input', { bubbles: true })); }
    try { products4.length = 0; addProduct4(process_env_PROD, 1, 359490, 'FT181266'); products4[0].imei = '350000000000000'; renderProducts4(); updatePreview4(); } catch (e) { return 'hiba: ' + e.message; }
    await new Promise(r => setTimeout(r, 400));
    if (window.__uj) document.documentElement.classList.add('ui-uj');
    window.print = () => {}; document.getElementById('printBtn').click();
    const f = document.getElementById('printFrame'), c = document.getElementById('printContent');
    return { page: document.getElementById('pageSizeStyle') && document.getElementById('pageSizeStyle').textContent, frameW: f.getBoundingClientRect().width, frameH: f.getBoundingClientRect().height, contentW: c.scrollWidth, contentH: c.scrollHeight, tr: c.style.transform };
  }, [process.env.TAB || 'erkezett', process.env.PROD || 'Samsung Galaxy S26 Ultra 5G Dual 256GB (Black) - 12 GB RAM']);
  await p.emulateMedia({ media: 'print' });
  await p.pdf({ path: process.env.O || '/tmp/cetli.pdf', preferCSSPageSize: true, printBackground: true });
  console.log(JSON.stringify(info), 'hibák:', errs.slice(0, 3)); await b.close();
})();
