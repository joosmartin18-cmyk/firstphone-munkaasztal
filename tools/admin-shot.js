// Admin felület helyi próbája ál-felhővel (kitalált boltokkal): PIN=1 (menü rögzítve), NAV=dash|shops|sched|acc|inbox|tix|ann|docs|train|set|data, TH=dark|light, LK=new|old, W, H, O, EV, FULL=1
const { chromium } = require('playwright');
const FAKE = `(function(){
  var _f=window.fetch; window.fetch=function(u,o){ if(String(u).indexOf("/api/admin")>=0){ var body={}; try{ body=JSON.parse((o&&o.body)||"{}"); }catch(e){} var users=[];
    if(body.action==="list"){ var D=(typeof FP_DOMAIN!=="undefined"?FP_DOMAIN:"firstphone.hu"), i=0; Object.keys(window.FP_LOGIN||{}).forEach(function(l){ i++; if(i%7===0) return; if(i===1){ for(var q=0;q<6;q++) users.push({email:"minta"+q+"@bolt.hu",last:Date.now()-q*36e5,created:Date.now()-90*864e5,pwAt:Date.now()}); } users.push({email:l+"@"+D,last:i%3?Date.now()-i*36e5:0,created:Date.now()-90*864e5,pwAt:Date.now()-i*864e5,disabled:i%11===0}); }); }
    return Promise.resolve(new Response(JSON.stringify({ok:true,users:users}),{headers:{"content-type":"application/json"}})); } return _f.apply(this,arguments); };
  var now=Date.now(), day=864e5;
  var names=["Minta A","Minta B","Minta C","Minta D","Minta E","Minta F"];
  var boltok={}, kv={};
  names.forEach(function(n,i){ var uid="u"+i; boltok[uid]={email:"minta"+i+"@bolt.hu",loc:n,place:"Pláza",addr:"Minta utca "+(i+1),ms:now-i*day*2};
    var d=new Date(), sch={}, T=["a","b","split","multi"]; for(var k=1;k<=31;k++){ if((k+i)%9===0) continue; var t=T[(k+i)%4]; sch[d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(k).padStart(2,"0")]= t==="split"?{type:"split",am:"a",pm:"c"}: t==="multi"?{type:"multi",full:["b"],am:["c"]}:{type:t}; }
    var st={year:d.getFullYear(),month:d.getMonth()+1,schedule:sch,settings:{configured:i!==3,location:n,uiLook:i===1?"old":i===2?"new":undefined,layout:i===1?"old":undefined,employees:[{id:"a",name:"Teszt Elek",hex:"#a78bfa"},{id:"b",name:"Próba Anna",hex:"#4fb3c4"},{id:"c",name:"Minta Béla",hex:"#f0953a"}],hours:Array(7).fill({open:"09:00",close:"20:00"})}};
    kv[uid]={firstphone_beosztas_tervezo_v2:{v:JSON.stringify(st),parts:0,by:"dev123456",n:now-i*day*2,t:now},
      firstphone_csomag:{v:JSON.stringify({items:[{id:1},{id:2,outAt:1},{id:3}]}),parts:0,by:"dev",n:now},
      firstphone_kassza:{v:JSON.stringify({n:{"1000":12,"5000":3},back:"20000",report:i%2?"47000":"46000"}),parts:0,by:"dev",n:now}};
  });
  var chat={u0:[{from:"s",name:"Teszt Elek · Minta A",text:"Szia! Megjött a heti áru, mindent bevételeztünk.",ms:now-3600e3},{from:"a",name:"Admin",text:"Köszönöm, szuper!",ms:now-3000e3},{from:"s",name:"Teszt Elek · Minta A",text:"A kassza ma 1000 Ft-tal több, holnap átnézem.",ms:now-600e3}],
    u1:[{from:"s",name:"Próba Anna · Minta B",text:"A nyomtató nem húzza be a papírt a cetlinél.",ms:now-7200e3,type:"bug",cat:"nyomtatas",page:"cetli",st:"new",prio:"hi"}],
    u2:[{from:"s",name:"Minta Béla · Minta C",text:"A leltár exportnál üres sor jelenik meg a végén.",ms:now-86400e3,type:"bug",cat:"hiba",page:"leltar",st:"wip"}]};
  function dsnap(path,data){ return {exists:!!data,id:path.split("/").pop(),data:function(){return data},get:function(k){return data&&data[k]},ref:mk(path)}; }
  function qsnap(docs){ return {docs:docs,empty:!docs.length,size:docs.length,forEach:function(f){docs.forEach(f)},docChanges:function(){return docs.map(function(d){return {type:"added",doc:d}})},metadata:{}}; }
  function read(path,grp){
    var p=path.split("/");
    if(grp==="kv"){ var o=[]; Object.keys(kv).forEach(function(u){ Object.keys(kv[u]).forEach(function(k){ o.push(dsnap("boltok/"+u+"/kv/"+k,kv[u][k])); }); }); return qsnap(o); }
    if(grp) return qsnap([]);
    if(p.length===1&&p[0]==="boltok") return qsnap(Object.keys(boltok).map(function(u){return dsnap("boltok/"+u,boltok[u])}));
    if(p.length===2&&p[0]==="boltok") return dsnap(path,boltok[p[1]]);
    if(p.length===3&&p[0]==="boltok"&&p[2]==="kv") return qsnap(Object.keys(kv[p[1]]||{}).map(function(k){return dsnap(path+"/"+k,kv[p[1]][k])}));
    if(p.length===3&&p[0]==="boltok"&&p[2]==="chat") return qsnap((chat[p[1]]||[]).map(function(x,j){return dsnap(path+"/"+x.ms+"_"+j,x)}));
    if(p.length===4&&p[0]==="boltok"&&p[2]==="kv") return dsnap(path,(kv[p[1]]||{})[p[3]]);
    return p.length%2 ? qsnap([]) : dsnap(path,undefined);
  }
  function mk(path,grp){ var q={path:path,id:path.split("/").pop()};
    Object.defineProperty(q,"parent",{get:function(){var p=path.split("/");p.pop();return p.length?mk(p.join("/")):null}});
    q.collection=function(n){return mk(path+"/"+n)}; q.doc=function(n){return mk(path+"/"+(n||"x"+Math.random().toString(36).slice(2)))};
    ["where","orderBy","limit","limitToLast","startAfter","endBefore"].forEach(function(m){q[m]=function(){return q}});
    q.get=function(){return Promise.resolve(read(path,grp))};
    q.onSnapshot=function(a,b){var cb=typeof a==="function"?a:b; setTimeout(function(){try{cb(read(path,grp))}catch(e){console.error(e)}},30); return function(){}};
    ["set","update","delete"].forEach(function(m){q[m]=function(){return Promise.resolve()}}); q.add=function(){return Promise.resolve(q.doc())};
    return q; }
  var db={collection:function(n){return mk(n)},collectionGroup:function(n){return mk(n,n)},doc:function(p){return mk(p)},settings:function(){},enablePersistence:function(){return Promise.resolve()},
    batch:function(){return {set:function(){},update:function(){},delete:function(){},commit:function(){return Promise.resolve()}}},runTransaction:function(){return Promise.resolve()}};
  var user={uid:"adminuid",email:"admin@admin.com",displayName:"",getIdTokenResult:function(){return Promise.resolve({claims:{}})},getIdToken:function(){return Promise.resolve("x")}};
  var auth={currentUser:window.__nouser?null:user,onAuthStateChanged:function(cb){setTimeout(function(){cb(window.__nouser?null:user)},20);return function(){}},signOut:function(){return Promise.resolve()},setPersistence:function(){return Promise.resolve()}};
  var fs=function(){return db}; fs.FieldValue={serverTimestamp:function(){return Date.now()},delete:function(){return null},increment:function(n){return n},arrayUnion:function(){return []},arrayRemove:function(){return []}};
  fs.Timestamp={now:function(){return {toMillis:function(){return Date.now()}}}}; fs.FieldPath={documentId:function(){return "__id"}};
  var au=function(){return auth}; au.Auth={Persistence:{LOCAL:"local",SESSION:"session",NONE:"none"}};
  window.firebase={apps:[],initializeApp:function(c,n){var a={name:n||"[DEFAULT]",auth:au,firestore:fs};firebase.apps.push(a);return a},firestore:fs,auth:au};
})();`;
(async () => {
  const b = await chromium.launch();
  const W = +process.env.W || 1366, H = +process.env.H || 800, LK = process.env.LK || 'new', TH = process.env.TH || 'dark', NAV = process.env.NAV || 'dash';
  const ctx = await b.newContext({ viewport: { width: W, height: H }, isMobile: W < 500, hasTouch: W < 500 });
  await ctx.route(/fonts\.(googleapis|gstatic)/, r => r.abort());
  await ctx.route(/firebasejs|npm\/firebase/, r => r.fulfill({ contentType: 'application/javascript', body: /app-compat/.test(r.request().url()) ? FAKE : '' }));
  if (process.env.NOUSER) await ctx.addInitScript(() => { window.__nouser = 1; });   // NOUSER=1: belépő oldal
  await ctx.route(/\/api\//, r => r.fulfill({ contentType: 'application/json', body: '{}' }));
  await ctx.addInitScript(([lk, pin]) => {
    if (sessionStorage.x) return; sessionStorage.x = 1;
    const s = { configured: true, location: 'Admin', employees: [], hours: Array(7).fill({ open: '09:00', close: '20:00' }), uiLook: lk };
    const d = new Date();
    localStorage.setItem('firstphone_beosztas_tervezo_v2', JSON.stringify({ year: d.getFullYear(), month: d.getMonth() + 1, schedule: {}, settings: s }));
    localStorage.setItem('firstphone_welcome_seen', '1');
    localStorage.setItem('fp_ui_news_seen', JSON.stringify(['uj-kinezet-2026-11', 'uj-kinezet-2026-11-09', 'frissites-2026-11-15', 'tudastar-diak-2026-11-15', 'cetli-szallitas-2026-11-16', 'cetli-tobb-egyben-2026-11-16', 'zen-hangok-2026-11-16', 'teendok-uj-2026-11-16']));
    if (pin) localStorage.setItem('fp_ax_nav2', pin === 'rail' ? 'rail' : 'pin');
  }, [LK, process.env.PIN || '']);
  if (process.env.NOW && ctx.clock) await ctx.clock.install({ time: new Date(process.env.NOW) });
  const p = await ctx.newPage(); const errs = []; if (process.env.CPU) { const cd = await ctx.newCDPSession(p); await cd.send('Emulation.setCPUThrottlingRate', { rate: +process.env.CPU }); }   // CPU=6: lassú gép p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://127.0.0.1:8765/index.html'); await p.mouse.move(W - 5, H - 5); await p.waitForTimeout(4000);
  const r = await p.evaluate(async ([nav, th, ev]) => {
    const A = document.getElementById('fcAdmin'); if (!A) return ev ? 'EV:' + (await eval(ev)) : 'NINCS ADMIN';
    if (th === 'light') { A.classList.remove('th-dark'); A.classList.add('th-light'); }
    const x = A.querySelector('[data-nav="' + nav + '"]'); if (x) { x.click(); x.blur(); } await new Promise(r => setTimeout(r, 1200));
    const o = { cls: A.className, ui: document.documentElement.className.slice(0, 80), kilog: document.documentElement.scrollWidth > innerWidth };
    if (ev) o.ev = await eval(ev);
    return JSON.stringify(o);
  }, [NAV, TH, process.env.EV || '']);
  await p.waitForTimeout(+process.env.T || 600);
  await p.screenshot({ path: process.env.O || '/tmp/adm.png', fullPage: !!process.env.FULL });
  console.log(r, 'hibák:', errs.slice(0, 5)); await b.close();
})();
