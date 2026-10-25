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

// v3.171: 開始〜終了がどちらも整数時（例: 9:00〜18:00）の予定・タスクだと、
// 終了時刻にはもともと「何もない時間の空の目盛」行が既にあり、終端用の行を
// 追加するコードがそれを見て「もう行があるからスキップ」としていたため、
// 既存の行にはspanEndフラグが付かず、時間目盛OFF時にラベルが出ないままだった
// （時間目盛ONなら元々全部ラベルが出るので気付かれなかった）。

T.db.tasks = [];
T.db.occurrences = [
  // 9:00〜18:00の予定。終了18:00はちょうど整数時＝空の目盛行と重なる。
  { id:"m1", taskId:null, date:today, title:"仕事", plan:true, status:"plan", plannedStart:"09:00", plannedMin:540, note:"" },
];
T.db.dayMeta = {};
T.db.settings = { hideTimeTicks: true }; // 時間目盛OFFで運用しているケース

T.renderToday();
{
  const html = elStore.main._html;
  const idx = html.indexOf('tl-row tick span-end');
  ok("a span-end tick row was created for the plan's end (18:00)", idx !== -1);
  const row = html.slice(idx, idx + 300);
  ok("the end time (18:00) is shown as a label even with 時間目盛 off", row.includes('<div class="tl-time">18:00</div>'));
  ok("the end row still has its dot node", row.includes('<span class="tl-node dot">'));
}

// 開始時刻（9:00）側は、ふつうに予定の帯＋ラベルの行として出ているはず
{
  const html = elStore.main._html;
  ok("the start time (09:00) row is still rendered normally", html.includes("仕事") && html.includes("09:00"));
}

console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAILURES`);
process.exit(fail ? 1 : 0);
