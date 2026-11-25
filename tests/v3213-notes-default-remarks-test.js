const fs = require("fs");
const vm = require("vm");
const path = require("path");

const src = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");

let fail = 0;
function ok(name, cond){
  if(cond){ console.log("PASS", name); } else { console.log("FAIL", name); fail++; }
}

function mkEl(){
  const listeners = {};
  const el = {
    _html: "", value: "",
    classList: { add(){}, remove(){}, toggle(){}, contains(){return false;} },
    style: {}, dataset: {}, children: [],
    addEventListener(ev, fn){ (listeners[ev] = listeners[ev]||[]).push(fn); },
    querySelector(){ return mkEl(); },
    querySelectorAll(){ return []; },
    closest(){ return null; },
    appendChild(){}, focus(){},
    get innerHTML(){ return this._html; },
    set innerHTML(v){ this._html = v; },
    getAttribute(){ return null; }, setAttribute(){}, remove(){},
    __listeners: listeners,
  };
  return el;
}

const documentListeners = {};
const M = mkEl();
const FAB = mkEl();
const FABM = mkEl(); FABM.hidden = true;
const elStore = { main: M, fab: FAB, fabMenu: FABM };

const fakeDocument = {
  addEventListener(ev, fn){ (documentListeners[ev] = documentListeners[ev]||[]).push(fn); },
  getElementById(id){ if(!elStore[id]) elStore[id] = mkEl(); return elStore[id]; },
  querySelector(){ return mkEl(); },
  querySelectorAll(){ return []; },
  createElement(){ return mkEl(); },
  body: mkEl(), documentElement: mkEl(),
};

const sandbox = {
  document: fakeDocument, window: {}, console,
  localStorage: (function(){
    let store = {};
    return {
      getItem(k){ return store[k]===undefined?null:store[k]; },
      setItem(k,v){ store[k]=String(v); },
      removeItem(k){ delete store[k]; },
    };
  })(),
  navigator: { onLine: true, serviceWorker: undefined },
  fetch: async ()=>({ ok:false }),
  setTimeout, clearTimeout, setInterval, clearInterval,
  requestAnimationFrame: (fn)=>setTimeout(fn,0),
  history: { replaceState(){} },
  location: { hash:"", search:"", href:"http://localhost/" },
  alert: ()=>{}, confirm: ()=>true,
  Notification: undefined, visualViewport: undefined,
  performance: { now:()=>Date.now() },
  crypto: require("crypto").webcrypto || {
    randomUUID(){ return require("crypto").randomUUID(); },
    getRandomValues(arr){ return require("crypto").randomFillSync(arr); },
  },
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.addEventListener = function(ev, fn){ (documentListeners["__win_"+ev] = documentListeners["__win_"+ev]||[]).push(fn); };
sandbox.removeEventListener = function(){};
sandbox.matchMedia = function(){ return { matches:false, addEventListener(){}, removeEventListener(){}, addListener(){}, removeListener(){} }; };

vm.createContext(sandbox);
try{
  vm.runInContext(src, sandbox, { filename: "app.js" });
}catch(e){
  console.log("SCRIPT THREW ON LOAD:", e.message);
  process.exit(1);
}
vm.runInContext(`globalThis.__t = { get db(){ return db; }, set db(v){ db=v; }, get state(){ return state; }, render };`, sandbox);
const T = sandbox.__t;

// v3.213: 「覚え書き・メモどちらもしっかり見れていない。特に覚え書きを
// 目に入りやすくしたい」との指摘。手始めとして、メモタブを開いたときの
// 既定サブビューを「メモ」から「覚え書き」に変更した。state.notesViewの
// 初期値そのものを変えたので、タブを開いて一度も切り替えていない
// （notes-viewを明示的にdispatchしていない）状態をそのまま再現して検証する。

ok("state.notesView's initial value (fresh app state) is \"remarks\"", T.state.notesView === "remarks");

T.db.remarks = [
  { id:"r1", text:"覚え書きのテスト項目", prio:"low", showFrom:null, showTo:null, createdAt:"", updatedAt:"" },
];
T.db.notes = [
  { id:"n1", title:"メモのテスト項目", body:"本文", createdAt:"", updatedAt:"" },
];
T.state.tab = "notes";
T.render();
const html = M.innerHTML;

ok("opening the メモ tab fresh shows the 覚え書き sub-tab as selected", /class="on"[^>]*data-act="notes-view" data-v="remarks"/.test(html) || /data-act="notes-view" data-v="remarks">覚え書き/.test(html) && html.includes('"on" data-act="notes-view" data-v="remarks"'));
ok("the 覚え書き item is shown by default", html.includes("覚え書きのテスト項目"));
ok("the メモ item is NOT shown by default (still on the 覚え書き sub-view)", !html.includes("メモのテスト項目"));

// 「メモ」へ切り替えればこれまで通り表示され、スワイプ/タップで行き来できることは変えていない。
const dispatchClick = (act, extra) => {
  const t = mkEl();
  t.dataset = Object.assign({ act }, extra||{});
  t.closest = function(sel){ if(sel === "[data-act]") return t; return null; };
  (documentListeners["click"]||[]).forEach(fn=>fn({ target:t, preventDefault(){}, stopPropagation(){} }));
};
dispatchClick("notes-view", { v: "notes" });
const html2 = M.innerHTML;
ok("switching to メモ still works and shows the メモ item", html2.includes("メモのテスト項目"));
ok("after switching to メモ, the 覚え書き item is no longer shown", !html2.includes("覚え書きのテスト項目"));

console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAILURES`);
process.exit(fail ? 1 : 0);
