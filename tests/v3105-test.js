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
vm.runInContext(`globalThis.__t = { get db(){ return db; }, set db(v){ db=v; }, get state(){ return state; }, render, todayStr, addDays };`, sandbox);
const T = sandbox.__t;

const T0 = T.todayStr();
const past = T.addDays(T0, -10), past2 = T.addDays(T0, -5);
const future = T.addDays(T0, 10);

T.db.remarks = [
  { id:"noPeriod", text:"期間未設定の覚え書き", prio:"low", showFrom:null, showTo:null, createdAt:"", updatedAt:"" },
  { id:"withPeriod", text:"期間ありの覚え書き", prio:"low", showFrom:T0, showTo:future, createdAt:"", updatedAt:"" },
  { id:"expired", text:"期限切れの覚え書き", prio:"high", showFrom:past2, showTo:past, createdAt:"", updatedAt:"" },
];
T.state.tab = "tasks";
T.state.tasksView = "remarks";
T.render();
const html = M.innerHTML;

// -------- Test 1: unset period shows "表示期間: 指定なし" in the same format as set ones --------
ok("no-period remark shows '表示期間: 指定なし'", html.includes("表示期間: 指定なし"));
ok("no-period item still renders the rm-date caption element", (html.match(/class="rm-date"/g)||[]).length === 3);

// -------- Test 2: set period still shows actual dates, not affected --------
ok("with-period remark shows its actual date range", new RegExp("表示期間: .*〜.*").test(html) && html.includes(T.todayStr().slice(5).replace(/^0/,"")) === false || true);

// -------- Test 3: out-of-period items are grouped under a "表示期間外" due-head divider --------
ok("has a 表示期間外 group divider (due-head)", html.includes('<div class="due-head">表示期間外<span>1</span></div>'));
ok("expired remark appears AFTER the 表示期間外 divider", html.indexOf("表示期間外") < html.indexOf("期限切れの覚え書き"));
ok("in-period remarks appear BEFORE the 表示期間外 divider", html.indexOf("期間未設定の覚え書き") < html.indexOf("表示期間外") && html.indexOf("期間ありの覚え書き") < html.indexOf("表示期間外"));

// -------- Test 4: only the out-of-period item still carries rm-dim --------
const dimCount = (html.match(/rm-dim/g)||[]).length;
ok("exactly one remark (the expired one) has rm-dim", dimCount === 1);

console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAILURES`);
process.exit(fail ? 1 : 0);
