const fs = require("fs");
const vm = require("vm");
const src = fs.readFileSync("C:\\Users\\hirom\\AppData\\Local\\Temp\\claude\\C--Users-hirom-Claude-LifeCore\\40dba0f7-d9f0-41be-aea7-13fea80b52f2\\scratchpad\\app.js", "utf8");
function mkEl(){
  const el = { dataset:{}, style:{}, value:"", classList:{add(){},remove(){},toggle(){},contains(){return false;}},
    addEventListener(){}, appendChild(){}, querySelector(){return mkEl();}, querySelectorAll(){return [];}, closest(){return null;}, focus(){}, scrollIntoView(){} };
  Object.defineProperty(el,"innerHTML",{get(){return this._h||"";},set(v){this._h=v;}});
  Object.defineProperty(el,"scrollTop",{get(){return 0;},set(v){}});
  return el;
}
const elCache = new Map();
const store = {};
const clickListeners = [];
const sandbox = {
  window:{addEventListener(){}},
  document:{
    addEventListener(name, fn){ if(name === "click") clickListeners.push(fn); },
    getElementById(id){ if(!elCache.has(id)) elCache.set(id, mkEl()); return elCache.get(id); },
    querySelector(){return mkEl();}, querySelectorAll(){return [];}, createElement(){return mkEl();}, body:mkEl(),
  },
  localStorage:{ getItem(k){return store[k]||null;}, setItem(k,v){store[k]=String(v);}, removeItem(k){delete store[k];} },
  navigator:{clipboard:{writeText:async()=>{}}},
  crypto:{randomUUID:()=>"aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"},
  console, setTimeout, clearTimeout, setInterval, clearInterval, Date,
};
sandbox.document.documentElement = mkEl();
sandbox.window.document = sandbox.document;
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: "app.js" });

function dispatchClick(actEl){
  const ev = { target: { closest: (sel) => (sel === "[data-act]" ? actEl : null) } };
  for(const fn of clickListeners) fn(ev);
}
function mkBtn(dataset){ const el = mkEl(); el.dataset = dataset; el.disabled = false; return el; }

let ok = true;
const check = (cond, msg) => { if(!cond){ ok=false; console.log("FAIL: "+msg); } else console.log("OK: "+msg); };

vm.runInContext(`state.tab = "settings";`, sandbox);
vm.runInContext(`renderSettings()`, sandbox);
let html = sandbox.document.getElementById("main").innerHTML;

check(html.includes('data-act="toggle-set" data-v="outlook"'), "今日の見通しが折りたたみヘッダー（他と同じ仕組み）になっている");
check(!html.includes('data-act="toggle-outlook"'), "デフォルトでは折りたたまれていて中のボタンは見えない");

// open it
dispatchClick(mkBtn({ act:"toggle-set", v:"outlook" }));
vm.runInContext(`renderSettings()`, sandbox);
html = sandbox.document.getElementById("main").innerHTML;
check(html.includes('data-act="toggle-outlook"'), "開くと中の表示切り替えボタンが見える");
check(html.includes('▼今日の見通し') || html.includes('▼</span>今日の見通し'), "開いた状態で▼になる");

// the inner button still works
dispatchClick(mkBtn({ act:"toggle-outlook" }));
const showOutlook = vm.runInContext(`settings().showOutlook`, sandbox);
check(showOutlook === false, "中のボタンを押すと showOutlook がトグルされる（従来通り機能する）");

// close it again
dispatchClick(mkBtn({ act:"toggle-set", v:"outlook" }));
vm.runInContext(`renderSettings()`, sandbox);
html = sandbox.document.getElementById("main").innerHTML;
check(!html.includes('data-act="toggle-outlook"'), "もう一度押すと閉じる");

// regression: other setCard sections still work (spot check "sync")
check(html.includes('data-act="toggle-set" data-v="sync"'), "同期・保存先の折りたたみも引き続き存在する（回帰なし）");

console.log(ok ? "\nALL PASS" : "\nSOME FAILED");
process.exit(ok?0:1);
