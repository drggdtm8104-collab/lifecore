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
vm.runInContext(`globalThis.__t = { get db(){ return db; }, set db(v){ db=v; }, todayStr, renderToday, settings };`, sandbox);
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

// v3.149: 「時間目盛ON」トグル — タイムラインの空き時間（予定・タスクの無い
// 時刻)のラベル文字だけを消す。ドット(.tl-node)は常に表示したまま、予定・
// タスクがある時刻のラベルも常に表示したままにする。

T.db.tasks = [{ id:"t1", name:"読書", kind:"single", freq:null, estMin:30, category:"その他", note:"", due:null, duePrec:"day", prio:"low", startDate:null, startPrec:"day", rtype:null, done:false, createdAt:today }];
T.db.occurrences = [
  { id:"o1", taskId:"t1", date:today, status:"planned", plannedStart:"09:00", plannedMin:30, actualMin:null, doneAt:null, adhoc:false, title:null, note:"" },
];
T.db.dayMeta = {};
T.db.settings = {};

// --- 1. デフォルト(未設定)は目盛ON——ボタンはprimary、空きの時刻ラベルも出る ---
T.renderToday();
{
  const html = elStore.main._html;
  ok("tick toggle button shows ON (primary) by default", /data-act="toggle-tick-labels"[^>]*class="btn primary tiny"|class="btn primary tiny"[^>]*data-act="toggle-tick-labels"/.test(html) || html.includes('btn primary tiny" data-act="toggle-tick-labels"'));
  ok("button label is 時間目盛ON", html.includes(">時間目盛ON<"));
  // 空の時刻(tick)行にラベル文字が出ている(例: 4:00など、hasItems以外の時間)
  ok("a bare tick row shows its time label by default", /tl-row tick[^"]*">[^<]*<div class="tl-time">\d/.test(html));
  // 予定/タスクの時刻(09:00)のラベルは出ている
  ok("the scheduled task's own time label is shown", html.includes('<div class="tl-time">09:00</div>'));
}

// --- 2. トグルを押すとOFFになる ---
dispatchClick("toggle-tick-labels");
ok("settings().hideTimeTicks becomes true after toggling", T.settings().hideTimeTicks === true);
{
  const html = elStore.main._html;
  ok("tick toggle button shows OFF (ghost) after toggling", html.includes('btn ghost tiny" data-act="toggle-tick-labels"'));
  // 空のtick行のラベルは消えているが、.tl-timeのdiv自体とドットは残る
  ok("a bare tick row's label text is now empty", /tl-row tick[^"]*">[^<]*<div class="tl-time"><\/div>/.test(html));
  ok("the dot node is still present on bare tick rows", /tl-row tick[^"]*">[^<]*<div class="tl-time"><\/div><span class="tl-node dot"><\/span>/.test(html));
  // 予定/タスクのある時刻(09:00)のラベルは消えずに残る
  ok("the scheduled task's own time label is still shown when ticks are off", html.includes('<div class="tl-time">09:00</div>'));
}

// --- 3. もう一度押すとONに戻る ---
dispatchClick("toggle-tick-labels");
ok("settings().hideTimeTicks becomes false again after toggling back", T.settings().hideTimeTicks === false);
{
  const html = elStore.main._html;
  ok("a bare tick row shows its time label again after toggling back on", /tl-row tick[^"]*">[^<]*<div class="tl-time">\d/.test(html));
}

console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAILURES`);
process.exit(fail ? 1 : 0);
