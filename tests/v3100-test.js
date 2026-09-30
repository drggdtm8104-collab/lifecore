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

vm.runInContext(`
  globalThis.__t = {
    get db(){ return db; }, set db(v){ db = v; },
    get state(){ return state; },
    render, latestOccOf, todayStr, addDays,
  };
`, sandbox);
const T = sandbox.__t;

function dispatchClick(target){
  const handlers = documentListeners["click"] || [];
  const evt = { target, preventDefault(){}, stopPropagation(){} };
  handlers.forEach(fn=>fn(evt));
}
function fakeTarget(dataAct, dataV, dataId){
  const t = mkEl();
  t.dataset = { act: dataAct, v: dataV, id: dataId };
  t.closest = function(sel){ if(sel === "[data-act]") return t; return null; };
  t.getAttribute = function(attr){
    if(attr==="data-act") return dataAct;
    if(attr==="data-v") return dataV;
    if(attr==="data-id") return dataId;
    return null;
  };
  return t;
}

// ---- set up: pick a single task, give it a note and an occurrence from YESTERDAY (not today) ----
const task = T.db.tasks.find(t=>t.kind==="single" && !t.done);
if(!task){ console.log("no open single task in seed data — cannot test"); process.exit(1); }
task.note = "テスト用の備考";
const yesterday = T.addDays(T.todayStr(), -1);
const oldOccId = "test-occ-yesterday";
T.db.occurrences.push({
  id: oldOccId, taskId: task.id, date: yesterday, plannedStart:"09:00", plannedMin:30,
  status:"done", note:"昨日はここまで進めた", actualMin:30, doneAt:new Date().toISOString(), adhoc:false, plan:false,
});

// -------- Test 1: latestOccOf finds the occurrence even though it's not today --------
const found = T.latestOccOf(task.id);
ok("latestOccOf finds yesterday's occurrence when no today occurrence exists", found && found.id === oldOccId);

// -------- Test 2: タスクタブのメモ表示に、今日ではない進捗メモが出る（日付ラベル付き） --------
T.state.tab = "tasks";
T.state.tasksView = "single";
if(!T.state._noteOpen) { /* ensure set exists via toggle */ }
T.render();
// open the note toggle for this task
dispatchClick(fakeTarget("toggle-note", null, task.id));
ok("progress note text from yesterday appears in タスクタブ even without a today occurrence", M.innerHTML.includes("昨日はここまで進めた"));
ok("date label (po-date) shown since it's not today's note", M.innerHTML.includes("po-date"));

// -------- Test 3: sheetTask shows the latest (non-today) progress note with a date label, not "今日" --------
let sheetHtml = "";
vm.runInContext(`openSheet = function(html){ globalThis.__lastSheet = html; };`, sandbox);
dispatchClick(fakeTarget("edit-task", null, task.id));
vm.runInContext(`globalThis.__sheetCheck = __lastSheet;`, sandbox);
sheetHtml = sandbox.__sheetCheck || "";
ok("sheetTask progress note field shows yesterday's note", sheetHtml.includes("昨日はここまで進めた"));
ok("sheetTask progress note label is NOT '今日の実施ぶん' (it's from yesterday)", !sheetHtml.includes("今日の実施ぶん") && sheetHtml.includes("時点の実施ぶん"));

// -------- Test 4: sheetOccEdit (via 履歴/ToDoリストの編集) now shows and can edit 備考 (task note) --------
dispatchClick(fakeTarget("edit-occ", null, oldOccId));
vm.runInContext(`globalThis.__sheetCheck2 = __lastSheet;`, sandbox);
const occSheetHtml = sandbox.__sheetCheck2 || "";
ok("sheetOccEdit includes a 備考 textarea (oeTaskNote) with the task's note", occSheetHtml.includes('id="oeTaskNote"') && occSheetHtml.includes("テスト用の備考"));
ok("sheetOccEdit still includes the per-day progress note (oeNote)", occSheetHtml.includes('id="oeNote"') && occSheetHtml.includes("昨日はここまで進めた"));

// -------- Test 5: saving via save-occ writes oeTaskNote back to t.note --------
elStore["oeTaskNote"] = mkEl();
elStore["oeTaskNote"].value = "備考を編集後のテキスト";
elStore["oeNote"] = mkEl();
elStore["oeNote"].value = "進捗メモも編集後";
elStore["oeStart"] = mkEl(); elStore["oeStart"].value = "09:00";
elStore["oeEnd"] = mkEl(); elStore["oeEnd"].value = "";
elStore["oeMin"] = mkEl(); elStore["oeMin"].value = "30";
dispatchClick(fakeTarget("save-occ", null, oldOccId));
ok("t.note updated via sheetOccEdit's 備考 field (save-occ)", task.note === "備考を編集後のテキスト");
ok("occurrence.note updated via sheetOccEdit's 進捗メモ field (save-occ)", T.db.occurrences.find(o=>o.id===oldOccId).note === "備考を編集後のテキスト" ? false : T.db.occurrences.find(o=>o.id===oldOccId).note === "進捗メモも編集後");

// -------- Test 6: adhoc occurrence (no task) does NOT show 備考 field --------
const adhocId = "test-adhoc-1";
T.db.occurrences.push({ id: adhocId, taskId: null, date: T.todayStr(), title:"アドホック予定", plannedStart:"10:00", plannedMin:20, status:"planned", note:"", actualMin:null, doneAt:null, adhoc:true, plan:false });
dispatchClick(fakeTarget("edit-occ", null, adhocId));
vm.runInContext(`globalThis.__sheetCheck3 = __lastSheet;`, sandbox);
const adhocSheetHtml = sandbox.__sheetCheck3 || "";
ok("adhoc occurrence's edit sheet has no 備考 field (no task to attach it to)", !adhocSheetHtml.includes('id="oeTaskNote"'));

console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAILURES`);
process.exit(fail ? 1 : 0);
