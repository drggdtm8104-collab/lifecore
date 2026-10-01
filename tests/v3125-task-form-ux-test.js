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
T.db.tasks = [];
T.db.occurrences = [];
T.state.date = today;

// -------- 1. タスク登録シートの項目名が太字スコープ(.tk-form)の中にある --------
T.sheetTask(null);
ok("sheetTask() wraps its fields in .tk-form so the bold-label CSS scopes correctly", sheetEl.innerHTML.includes('class="tk-form"'));
ok("the title field label is present inside the form", sheetEl.innerHTML.includes("<span>タイトル</span>"));

// -------- 2. 「保存して追加」ボタンがあり、保存後は「ToDoリストに追加」で
// タスクを選んだときと同じ、開始時刻を決める画面(sheetAddOcc)に続けて進む
// （v3.127〜。即座には追加されない——「タスクを追加」ボタンで確定する） --------
ok("sheetTask() shows a 保存して追加 button wired to save-task-add-today", sheetEl.innerHTML.includes('data-act="save-task-add-today"') && sheetEl.innerHTML.includes("保存して追加"));

elStore.tkName = mkEl("tkName"); elStore.tkName.value = "新しい資格勉強";
elStore.tkMin = mkEl("tkMin"); elStore.tkMin.value = "25";
elStore.tkNote = mkEl("tkNote"); elStore.tkNote.value = "";
dispatchClick("save-task-add-today");

ok("save-task-add-today creates exactly one task", T.db.tasks.length===1 && T.db.tasks[0].name==="新しい資格勉強");
const createdTaskId = T.db.tasks[0].id;
ok("save-task-add-today does NOT create an occurrence immediately", T.db.occurrences.length===0);
ok("save-task-add-today instead transitions to the start-time sheet (sheetAddOcc) for the newly-created task", sheetEl.innerHTML.includes('data-act="add-today"') && sheetEl.innerHTML.includes(`data-id="${createdTaskId}"`) && sheetEl.innerHTML.includes('id="aoStart"'));

// completing that follow-up screen (as if the user picked a time and confirmed)
// creates the occurrence via the existing add-today path
elStore.aoStart = mkEl("aoStart"); elStore.aoStart.value = "19:00";
elStore.aoEnd = mkEl("aoEnd"); elStore.aoEnd.value = "";
elStore.aoMin = mkEl("aoMin"); elStore.aoMin.value = "25";
dispatchClick("add-today", { id: createdTaskId });
ok("confirming the start-time screen creates today's occurrence with the chosen time", T.db.occurrences.length===1 && T.db.occurrences[0].taskId===createdTaskId && T.db.occurrences[0].date===today && T.db.occurrences[0].plannedStart==="19:00" && T.db.occurrences[0].status==="planned");

// -------- plain save-task (no "add today") still works and does NOT create an occurrence --------
T.db.tasks = [];
T.db.occurrences = [];
T.sheetTask(null);
elStore.tkName.value = "別のタスク";
dispatchClick("save-task");
ok("plain save-task still creates the task", T.db.tasks.length===1 && T.db.tasks[0].name==="別のタスク");
ok("plain save-task does NOT create an occurrence (unchanged existing behavior)", T.db.occurrences.length===0);

// -------- validation: an empty title blocks both save paths and creates nothing --------
T.db.tasks = [];
T.db.occurrences = [];
T.sheetTask(null);
elStore.tkName.value = "";
dispatchClick("save-task-add-today");
ok("save-task-add-today with an empty title creates nothing (validation still enforced)", T.db.tasks.length===0 && T.db.occurrences.length===0);

// -------- 3. 「ToDoリストに追加」シート: タイトルをボタンと同じ文言にし、
// 完了型/継続型の切替・並び順タブまでヘッダーごと固定にする（v3.128〜） --------
T.db.tasks = [{ id:"t1", name:"候補タスク", kind:"single", freq:null, estMin:null, category:"その他", note:"", due:null, duePrec:"day", prio:"low", startDate:null, startPrec:"day", rtype:null, done:false, createdAt:today }];
T.state.pickView = "single";
T.sheetTodayPick();
ok("sheetTodayPick()'s title now matches the FAB button label (ToDoリストに追加)", sheetEl.innerHTML.includes("<h2>ToDoリストに追加</h2>"));
ok("the whole header block (title+cancel, view toggle, sort tabs) is wrapped in one sticky container", sheetEl.innerHTML.includes('class="sheet-sticky-block"'));
ok("the title row and cancel button are inside that sticky block", sheetEl.innerHTML.includes('class="sheet-sticky-head"') && sheetEl.innerHTML.includes('data-act="close-sheet"') && sheetEl.innerHTML.includes("キャンセル"));
ok("the 完了型/継続型 view-toggle tabs are inside the sticky block", sheetEl.innerHTML.includes('data-act="pick-view"'));
ok("the 並び順 sort tabs are inside the sticky block (shown for the single/完了型 view)", sheetEl.innerHTML.includes('data-act="pick-sort"'));

console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAILURES`);
process.exit(fail ? 1 : 0);
