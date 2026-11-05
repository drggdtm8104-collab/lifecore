const fs = require("fs");
const vm = require("vm");
const path = require("path");

const src = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");

let fail = 0;
function ok(name, cond){
  if(cond){ console.log("PASS", name); } else { console.log("FAIL", name); fail++; }
}

function mkEl(id){
  const listeners = {};
  const el = {
    id, _html: "", value: "",
    classList: { add(){}, remove(){}, toggle(){}, contains(){return false;} },
    style: {}, dataset: {}, children: [],
    addEventListener(ev, fn){ (listeners[ev] = listeners[ev]||[]).push(fn); },
    querySelector(){ return mkEl(); },
    querySelectorAll(){ return []; },
    closest(){ return null; },
    appendChild(){}, focus(){}, remove(){},
    get innerHTML(){ return this._html; },
    set innerHTML(v){ this._html = v; },
    getAttribute(){ return null; }, setAttribute(){},
    __listeners: listeners,
  };
  return el;
}

const documentListeners = {};
const elStore = { main: mkEl("main"), fab: mkEl(), fabMenu: mkEl() };

const fakeDocument = {
  addEventListener(ev, fn){ (documentListeners[ev] = documentListeners[ev]||[]).push(fn); },
  getElementById(id){ if(!elStore[id]) elStore[id] = mkEl(id); return elStore[id]; },
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
vm.runInContext(`globalThis.__t = { get db(){ return db; }, set db(v){ db=v; }, get state(){ return state; }, renderTemplates };`, sandbox);
const T = sandbox.__t;

// v3.178: 「予定ボタンも色付けて」——テンプレ編集画面の「予定」セクションの
// 「＋ 追加」ボタンも、v3.177で緑にした「配置するタスク」の＋追加ボタンと
// 同じ primary（緑）クラスを付けて見つけやすくする。

T.db.templates = [{ id:"tpl1", name:"テスト用テンプレ", plans:[], tasks:[] }];
T.db.tasks = [];
T.state.settingsTplId = "tpl1";
T.state.tplView = "edit";
T.state._tplDraft = null;
T.renderTemplates();

{
  const html = elStore.main._html;
  ok("「予定」の＋追加ボタンがある", /data-act="tpl-add-row"/.test(html));
  ok("「予定」の＋追加ボタンにprimary（緑）クラスが付いている", /class="btn tiny primary"[^>]*data-act="tpl-add-row"/.test(html));
  ok("「配置するタスク」の＋追加ボタンも引き続きprimary（緑）のまま", /class="btn tiny primary"[^>]*data-act="tpl-task-add"/.test(html));
}

console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAILURES`);
process.exit(fail ? 1 : 0);
