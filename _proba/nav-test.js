/* PRÓBA: oldalsáv csoportok + összecsukás / rögzítés */
(function(){
  var H = document.documentElement, K = "fp_ui_nav";
  function get(){ try{ return localStorage.getItem(K) || "rail"; }catch(e){ return "rail"; } }
  function setm(m){ H.classList.toggle("ui-pin", m === "pin"); H.classList.toggle("ui-rail", m !== "pin"); try{ localStorage.setItem(K, m); }catch(e){}
    var b = document.querySelector(".ui-pinbtn"); if(b){ b.setAttribute("aria-pressed", m === "pin" ? "true" : "false"); b.title = m === "pin" ? "Menü összecsukása" : "Menü rögzítése (mindig nyitva)"; } }
  setm(get());
  var G = [["Napi munka", ["beosztas","teendo","kassza","csomag"]], ["Termékek", ["leltar","selejt","cetli","specko"]], ["Eladás és tudás", ["elado","tudastar"]]];
  var ICO = '<svg viewBox="0 0 256 256" fill="none" stroke="currentColor" stroke-width="16" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="40" y1="64" x2="216" y2="64"/><line x1="40" y1="128" x2="216" y2="128"/><line x1="40" y1="192" x2="216" y2="192"/></svg>';
  function group(){
    var ps = document.getElementById("pageSwitch"); if(!ps) return;
    if(!ps.querySelector(".ui-navtop")){
      var top = document.createElement("div"); top.className = "ui-navtop";
      top.innerHTML = '<button type="button" class="ui-pinbtn" aria-label="Menü rögzítése">' + ICO + '</button><b>Munkaasztal</b>';
      ps.insertBefore(top, ps.firstChild);
      top.querySelector("button").addEventListener("click", function(e){ e.stopPropagation(); setm(H.classList.contains("ui-pin") ? "rail" : "pin"); });
      setm(get());
    }
    var anchor = ps.querySelector(".ui-navtop");
    G.forEach(function(g){
      var h = ps.querySelector('.ui-grp[data-g="' + g[0] + '"]');
      if(!h){ h = document.createElement("div"); h.className = "ui-grp"; h.setAttribute("data-g", g[0]); h.textContent = g[0]; }
      if(anchor.nextSibling !== h) anchor.after(h); anchor = h;
      g[1].forEach(function(k){ var b = ps.querySelector('.ps-btn[data-page="' + k + '"]'); if(b){ if(anchor.nextSibling !== b) anchor.after(b); anchor = b; } });
    });
    ps.querySelectorAll(".ui-grp").forEach(function(h){ var n = h.nextElementSibling, any = false;
      while(n && !n.classList.contains("ui-grp")){ if(n.classList.contains("ps-btn") && getComputedStyle(n).display !== "none") any = true; n = n.nextElementSibling; }
      h.hidden = !any; });
    var an = document.querySelector("#fcAdmin .ax-nav");
    if(an){
      if(!an.querySelector(".ui-navtop")){ var tp = document.createElement("div"); tp.className = "ui-navtop"; tp.innerHTML = '<button type="button" class="ui-pinbtn" aria-label="Menü rögzítése">' + ICO + '</button><b>Admin</b>'; an.insertBefore(tp, an.firstChild);
        tp.querySelector("button").addEventListener("click", function(e){ e.stopPropagation(); setm(H.classList.contains("ui-pin") ? "rail" : "pin"); }); }
      var an2 = an.querySelector(".ui-navtop");
      [["Áttekintés", ["dash","shops","sched","acc"]], ["Kommunikáció", ["inbox","tix","ann","docs","train","news"]], ["Rendszer", ["set","data"]]].forEach(function(g){
        var h = an.querySelector('.ui-grp[data-g="' + g[0] + '"]'); if(!h){ h = document.createElement("div"); h.className = "ui-grp"; h.setAttribute("data-g", g[0]); h.textContent = g[0]; }
        if(an2.nextSibling !== h) an2.after(h); an2 = h;
        g[1].forEach(function(k){ var b = an.querySelector('button[data-nav="' + k + '"]'); if(b){ if(an2.nextSibling !== b) an2.after(b); an2 = b; } }); });
    }
    var t = document.querySelector("#fpTools .hdr-btns"); if(t) H.style.setProperty("--ui-tools", (t.offsetWidth + 40) + "px");
  }
  function start(){ try{ group(); }catch(e){} setInterval(function(){ try{ group(); }catch(e){} }, 1500); }
  if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
