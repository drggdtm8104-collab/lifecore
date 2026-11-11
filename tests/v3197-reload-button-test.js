const fs = require("fs");
const vm = require("vm");
const path = require("path");

const src = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");

let fail = 0;
function ok(name, cond){
  if(cond){ console.log("PASS", name); } else { console.log("FAIL", name); fail++; }
}

function mkEl(id){
  const el = {
    id, _html: "", value: "",
    classList: { add(){}, remove(){}, toggle(){}, contains(){return false;} },
    style: {}, dataset: {}, children: [],
    addEventListener(){}, querySelector(){ return mkEl(); }, querySelectorAll(){ return []; },
    closest(){ return null; }, appendChild(){}, remove(){}, focus(){},
    get innerHTML(){ return this._html; }, set innerHTML(v){ this._html = v; },
    getAttribute(){ return null; }, setAttribute(){},
  };
  return el;
}

const documentListeners = {};
const elStore = { main: mkEl("main") };
const fakeDocument = {
  addEventListener(ev, fn){ (documentListeners[ev] = documentListeners[ev]||[]).push(fn); },
  getElementById(id){ if(!elStore[id]) elStore[id] = mkEl(id); return elStore[id]; },
  querySelector(){ return mkEl(); }, querySelectorAll(){ return []; },
  createElement(){ return mkEl(); }, body: mkEl(), documentElement: mkEl(),
};

let reloadCalled = 0;
const sandbox = {
  document: fakeDocument, window: {}, console,
  localStorage: (function(){
    let store = {};
    return { getItem(k){ return store[k]===undefined?null:store[k]; }, setItem(k,v){ store[k]=String(v); }, removeItem(k){ delete store[k]; } };
  })(),
  navigator: { onLine: true, serviceWorker: undefined },
  fetch: async ()=>({ ok:false }),
  setTimeout, clearTimeout, setInterval, clearInterval,
  requestAnimationFrame: (fn)=>setTimeout(fn,0),
  history: { replaceState(){} },
  location: { hash:"", search:"", href:"http://localhost/", reload(){ reloadCalled++; } },
  alert: ()=>{}, confirm: ()=>true,
  Notification: undefined, visualViewport: undefined,
  performance: { now:()=>Date.now() },
  crypto: require("crypto").webcrypto || { randomUUID(){ return require("crypto").randomUUID(); }, getRandomValues(arr){ return require("crypto").randomFillSync(arr); } },
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.addEventListener = function(){};
sandbox.removeEventListener = function(){};
sandbox.matchMedia = function(){ return { matches:false, addEventListener(){}, removeEventListener(){}, addListener(){}, removeListener(){} }; };

vm.createContext(sandbox);
try{
  vm.runInContext(src, sandbox, { filename: "app.js" });
}catch(e){
  console.log("SCRIPT THREW ON LOAD:", e.message);
  process.exit(1);
}
vm.runInContext(`globalThis.__t = { get db(){ return db; }, set db(v){ db=v; }, get state(){ return state; }, renderSettings };`, sandbox);
const T = sandbox.__t;

function dispatchClick(dataAct, extra){
  const t = mkEl();
  t.dataset = Object.assign({ act: dataAct }, extra||{});
  t.closest = function(sel){ if(sel === "[data-act]") return t; return null; };
  const handlers = documentListeners["click"] || [];
  const evt = { target: t, preventDefault(){}, stopPropagation(){} };
  handlers.forEach(fn=>fn(evt));
}

// v3.197: 「毎回立ち上げ直してるんだけど、リロードできるボタンは作れない？」
// との指示。ホーム画面に追加したPWAはアイコンをタップしても既存の画面が
// そのまま前面に出るだけで、デプロイした最新版を見るには毎回完全に閉じて
// 開き直す必要があった——sw.jsのnavigateは常にネット優先（cache:"no-store"）
// なので、location.reload()するだけで最新版が取れる。そのための
// 「設定」画面のボタンを追加した。

T.db = { settings:{}, templates:[], tasks:[], occurrences:[], dayMeta:{}, notes:[], remarks:[], meta:{ savedAt: Date.now() } };
T.state.tab = "settings";
T.renderSettings();
const html = sandbox.document.getElementById("main").innerHTML;

ok("設定画面に「再読み込み」ボタンがある", /data-act="reload-app">再読み込み<\/button>/.test(html));
ok("「再読み込み」ボタンはバージョン表示と同じ行にある", /LifeCore v[\s\S]*?data-act="reload-app"/.test(html));

dispatchClick("reload-app");
ok("「再読み込み」ボタンを押すとlocation.reload()が呼ばれる", reloadCalled === 1);

console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAILURES`);
process.exit(fail ? 1 : 0);
