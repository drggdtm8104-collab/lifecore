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
vm.runInContext(`globalThis.__t = { get db(){ return db; }, set db(v){ db=v; }, applyTemplate, todayStr };`, sandbox);
const T = sandbox.__t;
const today = T.todayStr();

// applyTemplate()内のタスク再利用ロジックは、同じタスクが1日に複数の時間枠に
// ある場合（「水」を1日3回など）、配列の先頭を無条件に採用していた。テンプレの
// 行の並び順と既存occurrenceの配列順がズレると、メモ・実績時間などが違う
// 時間枠に付け替わってしまう——今回、時刻優先でマッチするよう修正した。

// タスク・テンプレートを自前で用意する（seedデータの中身に依存しないため）。
T.db.tasks.push({ id:"watertask", kind:"repeat", name:"水", rtype:"routine", freq:{type:"daily"} });
T.db.templates.push({
  id:"slottpl", name:"水分補給テスト",
  plans: [],
  tasks: [
    { taskId:"watertask", time:"08:00", mins:5 },
    { taskId:"watertask", time:"17:00", mins:5 },
  ],
});

// 1回目の適用: 08:00枠・17:00枠の2件ができるはず
T.applyTemplate(today, "slottpl");
const occs1 = T.db.occurrences.filter(o=>o.date===today && o.taskId==="watertask");
ok("first apply creates one occurrence per time slot", occs1.length === 2);
const morning = occs1.find(o=>o.plannedStart==="08:00");
const evening = occs1.find(o=>o.plannedStart==="17:00");
ok("both time slots were created with their own plannedStart", !!morning && !!evening);

// それぞれの枠に見分けのつくメモを付けておく（実際の運用でユーザーが書く
// 進捗メモに相当）
morning.note = "朝のメモ";
evening.note = "夕方のメモ";
const morningId = morning.id, eveningId = evening.id;

// 2回目の適用: テンプレの行の並び順をわざと入れ替える（ユーザーがテンプレを
// 編集して行の順序が変わった場合を想定）。もし時刻でマッチしていなければ、
// 配列順で誤って入れ替わってしまう。
const tpl = T.db.templates.find(t=>t.id==="slottpl");
tpl.tasks.reverse();   // [17:00, 08:00] の順にする
T.applyTemplate(today, "slottpl");

const occs2 = T.db.occurrences.filter(o=>o.date===today && o.taskId==="watertask");
ok("re-applying with reordered template rows still yields exactly 2 occurrences (no duplication)", occs2.length === 2);

const morningAfter = T.db.occurrences.find(o=>o.id===morningId);
const eveningAfter = T.db.occurrences.find(o=>o.id===eveningId);
ok("the occurrence that had the morning note is still the 08:00 slot", morningAfter && morningAfter.plannedStart === "08:00");
ok("the occurrence that had the evening note is still the 17:00 slot", eveningAfter && eveningAfter.plannedStart === "17:00");
ok("the morning note stayed attached to the 08:00 slot (not swapped to 17:00)", morningAfter && morningAfter.note === "朝のメモ");
ok("the evening note stayed attached to the 17:00 slot (not swapped to 08:00)", eveningAfter && eveningAfter.note === "夕方のメモ");

console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAILURES`);
process.exit(fail ? 1 : 0);
