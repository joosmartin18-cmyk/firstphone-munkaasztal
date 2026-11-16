// Leltár próba-export betöltése (kitalált termékekkel) — tools/shot.js EV-be: EV="$(cat tools/lt-demo.js)"
(async function(){
  var rows = ["16.11.2026 08:00;;;;", "Cikk;Csoport;Kód;Tétel;Készleten"];
  var ph = ["Galaxy A16 128GB Fekete","Galaxy A26 256GB Kék","Galaxy S25 256GB Ezüst","Redmi Note 14 128GB","iPhone 16 128GB Fekete","iPhone 15 128GB Kék","Moto G85 256GB","Galaxy A56 128GB Szürke"];
  ph.forEach(function(n,i){ rows.push(n+";Samsung;"+(100100+i)+";35"+String(1234567890123+i).slice(0,13)+";1"); rows.push(n+";Samsung;"+(100100+i)+";35"+String(1234567890999+i).slice(0,13)+";1"); });
  ["ShieldUp üvegfólia A16","ShieldUp üvegfólia S25","ShieldUp tok iPhone 16","ShieldUp kamera védő"].forEach(function(n,i){ rows.push(n+";ShieldUp;"+(200200+i)+";;"+(3+i)); });
  var f = new File([rows.join("\n")], "probaexport.csv", { type:"text/csv" });
  var inp = document.querySelector("#ltDrop input[type=file]") || document.querySelector("#ltPage input[type=file]");
  var dt = new DataTransfer(); dt.items.add(f); inp.files = dt.files; inp.dispatchEvent(new Event("change", { bubbles:true }));
  await new Promise(function(r){ setTimeout(r, 1500); });
  return !document.getElementById("ltData").hidden;
})()
