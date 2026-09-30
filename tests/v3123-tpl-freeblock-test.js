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
const elStore = { main: mkEl(), fab: mkEl(), fabMenu: mkEl() };

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
vm.runInContext(`globalThis.__t = { get db(){ return db; }, set db(v){ db=v; }, applyTemplate, todayStr, freeGapsFrom, timeKey };`, sandbox);
const T = sandbox.__t;
const today = T.todayStr();

// v3.123: 実運用フィードバック — テンプレートで置いている「自由時間」の予定
// (時間指定あり) が freeGapsFrom() に占有扱いされ、ひと段落が提案できなかった。
// sheetMarker側（日ごとの実施）にチェックを足しただけでは、テンプレを
// 再適用するたびに元に戻ってしまうため、テンプレの予定行自体にも
// freeBlockを持たせ、applyTemplate()で毎回コピーされるようにした。

T.db.tasks = [];
T.db.templates = [{
  id: "tpl1", name: "テスト用テンプレ",
  plans: [
    { time:"09:00", label:"仕事", mins:480, category:"仕事", freeBlock:false },
    { time:"20:00", label:"自由時間", mins:180, category:"その他", freeBlock:true },
  ],
  tasks: [],
}];
T.db.occurrences = [];

// -------- 初回適用: freeBlock:trueの行は、生成される実施にもfreeBlock:trueが付く --------
T.applyTemplate(today, "tpl1");
const workOcc = T.db.occurrences.find(o=>o.date===today && o.title==="仕事");
const freeOcc = T.db.occurrences.find(o=>o.date===today && o.title==="自由時間");
ok("a template plan row with freeBlock:false creates an occurrence with freeBlock:false", workOcc && workOcc.freeBlock===false);
ok("a template plan row with freeBlock:true creates an occurrence with freeBlock:true", freeOcc && freeOcc.freeBlock===true);

// -------- freeGapsFrom()は、テンプレ由来のfreeBlock:true行を占有扱いしない --------
let gaps = T.freeGapsFrom(today, T.timeKey("09:00"), T.timeKey("23:00"));
// 仕事(09:00-17:00)は占有として残り、自由時間(20:00-23:00)は空きとして使えるはず
const workEndKey = T.timeKey("09:00") + 480;
ok("the work block (freeBlock:false) still occupies its time", gaps.every(g => !(g.start < workEndKey && g.end > T.timeKey("09:00"))));
ok("the freeBlock:true evening block is available as free time", gaps.some(g => g.start <= T.timeKey("20:00") && g.end >= T.timeKey("23:00")));

// -------- 再適用: テンプレ側の値が既存の実施へ毎回コピーされる（日ごとの手直しは残らない） --------
// まず日ごとに手動でfreeBlockをfalseへ上書き（sheetMarker相当の操作を模した状態）
freeOcc.freeBlock = false;
T.applyTemplate(today, "tpl1");
const freeOccAfter = T.db.occurrences.find(o=>o.date===today && o.title==="自由時間");
ok("re-applying the template re-syncs freeBlock from the template row (day-level override does not survive)", freeOccAfter && freeOccAfter.freeBlock===true);

// -------- テンプレ側でfreeBlockをオフに変更して再適用すると、実施側も追従する --------
T.db.templates[0].plans[1].freeBlock = false;
T.applyTemplate(today, "tpl1");
const freeOccAfter2 = T.db.occurrences.find(o=>o.date===today && o.title==="自由時間");
ok("changing the template row's freeBlock to false and re-applying updates the occurrence too", freeOccAfter2 && freeOccAfter2.freeBlock===false);

// -------- 新しい日への初回適用でも、テンプレのfreeBlockがそのまま使われる --------
const tomorrow = (function(){ const [y,m,d]=today.split("-").map(Number); const dt=new Date(y,m-1,d+1); return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,"0")}-${String(dt.getDate()).padStart(2,"0")}`; })();
T.db.templates[0].plans[1].freeBlock = true;
T.applyTemplate(tomorrow, "tpl1");
const freeOccTomorrow = T.db.occurrences.find(o=>o.date===tomorrow && o.title==="自由時間");
ok("applying the template to a brand-new day also carries freeBlock over, no per-day setup needed", freeOccTomorrow && freeOccTomorrow.freeBlock===true);

console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAILURES`);
process.exit(fail ? 1 : 0);
