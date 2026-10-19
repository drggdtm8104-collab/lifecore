const fs = require("fs");
const vm = require("vm");
const path = require("path");

const src = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");

let fail = 0;
function ok(name, cond){
  if(cond){ console.log("PASS", name); } else { console.log("FAIL", name); fail++; }
}

function mkEl(){
  const el = {
    _html: "", value: "",
    classList: { add(){}, remove(){}, toggle(){}, contains(){return false;} },
    style: {}, dataset: {}, children: [],
    addEventListener(){}, querySelector(){ return mkEl(); }, querySelectorAll(){ return []; },
    closest(){ return null; }, appendChild(){}, focus(){}, remove(){},
    get innerHTML(){ return this._html; }, set innerHTML(v){ this._html = v; },
    getAttribute(){ return null; }, setAttribute(){},
  };
  return el;
}

const documentListeners = {};
const elStore = { main: mkEl(), fab: mkEl(), fabMenu: mkEl() };
const fakeDocument = {
  addEventListener(ev, fn){ (documentListeners[ev] = documentListeners[ev]||[]).push(fn); },
  getElementById(id){ if(!elStore[id]) elStore[id] = mkEl(); return elStore[id]; },
  querySelector(){ return mkEl(); }, querySelectorAll(){ return []; },
  createElement(){ return mkEl(); }, body: mkEl(), documentElement: mkEl(),
};

const sandbox = {
  document: fakeDocument, window: {}, console,
  localStorage: (function(){
    let store = {};
    return { getItem(k){ return store[k]===undefined?null:store[k]; }, setItem(k,v){ store[k]=String(v); }, removeItem(k){ delete store[k]; } };
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
  crypto: require("crypto").webcrypto || { randomUUID(){ return require("crypto").randomUUID(); } },
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
vm.runInContext(`globalThis.__t = { get db(){ return db; }, set db(v){ db=v; }, get state(){ return state; }, render, todayStr, addDays };`, sandbox);
const T = sandbox.__t;

function dispatchClick(target){
  const handlers = documentListeners["click"] || [];
  const evt = { target, preventDefault(){}, stopPropagation(){} };
  handlers.forEach(fn=>fn(evt));
}
function fakeTarget(dataAct, dataId){
  const t = mkEl();
  t.dataset = { act: dataAct, id: dataId };
  t.closest = function(sel){ if(sel === "[data-act]") return t; return null; };
  return t;
}

// ---- setup: a repeat task WITH a note, plus a progress note from yesterday ----
T.db.tasks.push({ id:"rt1", name:"ストレッチ", kind:"repeat", freq:{type:"daily"}, category:"健康",
  note:"朝起きてすぐやる", due:null, prio:"low", startDate:null, rtype:"routine", done:false, createdAt:"2026-10-01" });
const yesterday = T.addDays(T.todayStr(), -1);
T.db.occurrences.push({ id:"rocc1", taskId:"rt1", date:yesterday, plannedStart:null, plannedMin:null,
  actualMin:10, status:"done", doneAt:new Date().toISOString(), adhoc:false, title:null, note:"腰が張っていた", plan:false });

// ---- a repeat task with NO note at all (neither task note nor any occurrence note) ----
T.db.tasks.push({ id:"rt2", name:"水を飲む", kind:"repeat", freq:{type:"daily"}, category:"健康",
  note:"", due:null, prio:"low", startDate:null, rtype:"routine", done:false, createdAt:"2026-10-01" });

T.state.tab = "tasks";
T.state.tasksView = "repeat";
T.render();
let html = elStore.main.innerHTML;

// -------- 1: a repeat task with a note shows the メモ toggle, closed by default --------
ok("repeat task row is a div (not a button, so the memo toggle can nest inside it)", html.includes('class="task-item" data-act="edit-task" data-id="rt1"'));
ok("メモ toggle button appears for a repeat task that has a note", html.includes('data-act="toggle-note" data-id="rt1"'));
ok("the note text itself is not shown yet (closed by default)", !html.includes("朝起きてすぐやる") && !html.includes("腰が張っていた"));

// -------- 2: opening it shows both the task's own note and the latest progress note, dated --------
dispatchClick(fakeTarget("toggle-note", "rt1"));
html = elStore.main.innerHTML;
ok("opening the toggle reveals the task's own note", html.includes("朝起きてすぐやる"));
ok("opening the toggle reveals the latest occurrence's progress note", html.includes("腰が張っていた"));
ok("a date label (po-date) is shown since the progress note is from yesterday, not today", html.includes("po-date"));

// -------- 3: a repeat task with no note at all gets no メモ toggle --------
ok("a repeat task with no note anywhere has no メモ toggle", !html.includes('data-act="toggle-note" data-id="rt2"'));

// -------- 4: clicking the row itself (not the toggle) still opens the edit sheet (regression: button->div) --------
vm.runInContext(`openSheet = function(h){ globalThis.__lastSheet = h; };`, sandbox);
dispatchClick(fakeTarget("edit-task", "rt1"));
const sheetHtml = sandbox.__lastSheet || "";
ok("clicking the row (edit-task) still opens the task edit sheet", sheetHtml.includes("タスクを編集"));

console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAILURES`);
process.exit(fail ? 1 : 0);
