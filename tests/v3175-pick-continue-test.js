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
const elStore = { main: mkEl(), fab: mkEl(), fabMenu: mkEl() };

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
vm.runInContext(`globalThis.__t = { get db(){ return db; }, set db(v){ db=v; }, get state(){ return state; }, render, sheetTask, sheetTodayPick, todayStr };`, sandbox);
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

const sheetEl = elStore.sheet || (elStore.sheet = mkEl("sheet"));

// v3.175: 「スケジュールタブからToDoリストにタスクを追加したとき、最初の
// ページではなく、『ToDoリストに追加』のページへ戻るようにして、続けて
// タスク追加しやすいようにして」——候補一覧(sheetTodayPick)から選んで
// 追加したときだけ、確定後に候補一覧へ戻る。タスク登録画面の「保存して
// 追加」経由のときは従来通り閉じる。

// -------- 1. 候補一覧 → 選択 → 追加: 追加後は候補一覧に戻る（閉じない） --------
T.db.tasks = [
  { id:"t1", name:"候補タスクA", kind:"single", freq:null, estMin:null, category:"その他", note:"", due:null, duePrec:"day", prio:"low", startDate:null, startPrec:"day", rtype:null, done:false, createdAt:today },
  { id:"t2", name:"候補タスクB", kind:"single", freq:null, estMin:null, category:"その他", note:"", due:null, duePrec:"day", prio:"low", startDate:null, startPrec:"day", rtype:null, done:false, createdAt:today },
];
T.db.occurrences = [];
T.state.date = today;
T.state.pickView = "single";

T.sheetTodayPick();
ok("候補一覧が開く", sheetEl.innerHTML.includes("<h2>ToDoリストに追加</h2>"));

dispatchClick("pick-add", { id: "t1" });
ok("候補を選ぶと開始時刻入力画面(sheetAddOcc)に進む", sheetEl.innerHTML.includes('data-act="add-today"') && sheetEl.innerHTML.includes('data-id="t1"'));

elStore.aoStart = mkEl("aoStart"); elStore.aoStart.value = "";
elStore.aoEnd = mkEl("aoEnd"); elStore.aoEnd.value = "";
dispatchClick("add-today", { id: "t1" });

ok("タスクが追加される", T.db.occurrences.some(o=>o.taskId==="t1"));
ok("追加後、シートが閉じずに候補一覧へ戻る", sheetEl.innerHTML.includes("<h2>ToDoリストに追加</h2>"));
ok("追加ずみの候補(t1)は一覧から外れる", !sheetEl.innerHTML.includes("候補タスクA"));
ok("まだ追加していない候補(t2)は引き続き出る", sheetEl.innerHTML.includes("候補タスクB"));

// -------- 2. 続けて2件目を追加できる --------
dispatchClick("pick-add", { id: "t2" });
elStore.aoStart.value = ""; elStore.aoEnd.value = "";
dispatchClick("add-today", { id: "t2" });
ok("2件目のタスクも追加される", T.db.occurrences.some(o=>o.taskId==="t2"));
ok("2件目の追加後も候補一覧に戻る", sheetEl.innerHTML.includes("<h2>ToDoリストに追加</h2>"));

// -------- 3. タスク登録画面の「保存して追加」経由では、追加後に候補一覧へ
// 戻らず、従来通りシートを閉じる --------
T.db.tasks = [];
T.db.occurrences = [];
T.sheetTask(null);
elStore.tkName = mkEl("tkName"); elStore.tkName.value = "新規タスク";
elStore.tkMin = mkEl("tkMin"); elStore.tkMin.value = "";
elStore.tkNote = mkEl("tkNote"); elStore.tkNote.value = "";
dispatchClick("save-task-add-today");
const createdId = T.db.tasks[0].id;
ok("保存して追加→開始時刻入力画面に進む", sheetEl.innerHTML.includes('data-act="add-today"') && sheetEl.innerHTML.includes(`data-id="${createdId}"`));

elStore.aoStart.value = ""; elStore.aoEnd.value = "";
dispatchClick("add-today", { id: createdId });
ok("保存して追加経由でもタスクは追加される", T.db.occurrences.some(o=>o.taskId===createdId));
ok("保存して追加経由では、追加後は候補一覧に戻らずシートが閉じる", sheetEl.innerHTML === "");

console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAILURES`);
process.exit(fail ? 1 : 0);
