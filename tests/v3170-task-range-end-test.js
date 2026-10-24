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

// v3.170: 開始〜終了の範囲を指定したタスク（予定とは違い、タイムテーブル上
// では帯を持たない）でも、終了時刻にはドット＋ラベルが出るようにした。
// それまでは「帯を持たない＝spansに入らない＝終端用のtick行が作られない」
// ため、範囲指定したタスクの終了時刻はタイムテーブル上に何の印も残らず、
// 開始時刻しか見えなかった。

T.db.tasks = [{ id:"t1", name:"読書", kind:"single", freq:null, estMin:60, category:"その他", note:"", due:null, duePrec:"day", prio:"low", startDate:null, startPrec:"day", rtype:null, done:false, createdAt:today }];
T.db.occurrences = [
  // 19:00〜20:30 のタスク（90分）。終了20:30はどの項目の開始にも重ならない。
  { id:"o1", taskId:"t1", date:today, status:"planned", plannedStart:"19:00", plannedMin:90, actualMin:null, doneAt:null, adhoc:false, title:null, note:"" },
];
T.db.dayMeta = {};
T.db.settings = {};

T.renderToday();
{
  const html = elStore.main._html;
  const idx = html.indexOf('tl-row tick span-end');
  ok("a span-end tick row was created for the task's range end", idx !== -1);
  const row = html.slice(idx, idx + 300);
  ok("the task's end time (20:30) is shown as a label", row.includes('<div class="tl-time">20:30</div>'));
  ok("the end row still has its dot node", row.includes('<span class="tl-node dot">'));
  // 帯（色付きバー）は予定・目印専用のまま——タスクには付けない設計は変えない
  ok("no colored span background band was added for the task (bars stay empty)", row.includes('<span class="tl-time">') === false && !/span-bg--marker/.test(row));
}

// 「時間目盛」をOFFにしても、タスクの終了ラベルは消えない
{
  const b = mkEl();
  b.dataset = { act:"toggle-tick-labels" };
  b.closest = function(sel){ if(sel === "[data-act]") return b; return null; };
  const handlers = documentListeners["click"] || [];
  handlers.forEach(fn=>fn({ target:b, preventDefault(){}, stopPropagation(){} }));
}
{
  const html = elStore.main._html;
  ok("settings().hideTimeTicks is true after toggling", T.settings().hideTimeTicks === true);
  const idx = html.indexOf('tl-row tick span-end');
  const row = html.slice(idx, idx + 300);
  ok("the task's end time (20:30) is still shown with ticks off", row.includes('<div class="tl-time">20:30</div>'));
}

console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAILURES`);
process.exit(fail ? 1 : 0);
