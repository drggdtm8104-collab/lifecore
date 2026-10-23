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
vm.runInContext(`globalThis.__t = { get db(){ return db; }, set db(v){ db=v; }, todayStr, renderToday, settings, state };`, sandbox);
const T = sandbox.__t;
const today = T.todayStr();

function dispatchClick(dataAct, extra){
  const t = mkEl();
  t.dataset = Object.assign({ act: dataAct }, extra||{});
  t.closest = function(sel){ if(sel === "[data-act]") return t; return null; };
  const handlers = documentListeners["click"] || [];
  const evt = { target: t, preventDefault(){}, stopPropagation(){} };
  handlers.forEach(fn=>fn(evt));
}

// v3.169: 範囲のある予定（plan:true, plannedMin持ち）の終了時刻の行は、
// 「時間目盛ON」をOFFにしても、他の空きの時刻目盛とは違ってラベル文字を
// 出し続けるようにした（それまではドットだけになっていた）。

T.db.tasks = [];
T.db.occurrences = [
  // 10:00〜11:30 の範囲のある予定（例: 仕事）。終了11:30はどの項目の開始時刻にも
  // 重ならない独立した行になるようにする。
  { id:"p1", taskId:null, date:today, plan:true, status:"planned", plannedStart:"10:00", plannedMin:90, actualMin:null, doneAt:null, adhoc:true, title:"仕事", note:"" },
];
T.db.dayMeta = {};
T.db.settings = {};

// --- 1. デフォルト(目盛ON)では終了時刻(11:30)の行にラベルが出る ---
T.renderToday();
{
  const html = elStore.main._html;
  ok("span-end row (11:30) shows its time label by default", html.includes('<div class="tl-time">11:30</div>'));
  ok("span-end row has the span-end class", /tl-row tick span-end/.test(html));
}

// --- 2. 「時間目盛ON」をOFFにしても、終了時刻のラベルは消えない ---
dispatchClick("toggle-tick-labels");
ok("settings().hideTimeTicks becomes true after toggling", T.settings().hideTimeTicks === true);
{
  const html = elStore.main._html;
  ok("span-end row (11:30) STILL shows its time label when ticks are off", html.includes('<div class="tl-time">11:30</div>'));
  const spanEndIdx = html.indexOf('tl-row tick span-end');
  const spanEndRow = html.slice(spanEndIdx, spanEndIdx + 300);
  ok("span-end row still has its dot node", spanEndRow.includes('<div class="tl-time">11:30</div>') && spanEndRow.includes('<span class="tl-node dot">'));
  // 無関係な空きのtick行(範囲の終了ではない時刻)のラベルは、OFFのときは消えたままでよい
  ok("an unrelated bare tick row's label is still hidden when ticks are off", /tl-row tick ">[^<]*<div class="tl-time"><\/div>/.test(html));
}

// --- 3. 目盛をONに戻しても変わらず出る ---
dispatchClick("toggle-tick-labels");
{
  const html = elStore.main._html;
  ok("span-end row (11:30) shows its time label again after toggling back on", html.includes('<div class="tl-time">11:30</div>'));
}

console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAILURES`);
process.exit(fail ? 1 : 0);
