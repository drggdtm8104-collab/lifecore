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

// ---- reproduce the reported bug: task worked on yesterday (progress note written),
// not finished, then placed back onto TODAY's schedule via "add-today" ----
const task = T.db.tasks.find(t=>t.kind==="single" && !t.done);
if(!task){ console.log("no open single task in seed data — cannot test"); process.exit(1); }

const yesterday = T.addDays(T.todayStr(), -1);
const oldOccId = "test-occ-yesterday-2";
T.db.occurrences.push({
  id: oldOccId, taskId: task.id, date: yesterday, plannedStart:"09:00", plannedMin:30,
  status:"planned", note:"第3章の途中まで進めた", actualMin:null, doneAt:null, adhoc:false, plan:false,
});

// sanity: before placing today, latestOccOf should surface yesterday's note
const before = T.latestOccOf(task.id);
ok("before placing today: latestOccOf surfaces yesterday's note", before && before.note === "第3章の途中まで進めた");

// simulate "add-today": open the sheetAddOcc-driven add flow via case "add-today"
// (leave aoStart/aoEnd/aoMin blank -> untimed add, matches "この時刻で追加"/blank flow)
elStore["aoStart"] = mkEl(); elStore["aoStart"].value = "";
elStore["aoEnd"] = mkEl(); elStore["aoEnd"].value = "";
elStore["aoMin"] = mkEl(); elStore["aoMin"].value = "";
const beforeCount = T.db.occurrences.length;
dispatchClick(fakeTarget("add-today", null, task.id));
ok("add-today created a new occurrence for today", T.db.occurrences.length === beforeCount + 1);

const todayOcc = T.db.occurrences.find(o=>o.taskId===task.id && o.date===T.todayStr() && !o.plan);
ok("today's newly created occurrence carries forward yesterday's note (not blank)", todayOcc && todayOcc.note === "第3章の途中まで進めた");

// -------- the actual regression check: タスクタブに進捗メモがまだ見える --------
T.state.tab = "tasks";
T.state.tasksView = "single";
T.render();
dispatchClick(fakeTarget("toggle-note", null, task.id));
ok("progress note still visible in タスクタブ after placing task on today's schedule", M.innerHTML.includes("第3章の途中まで進めた"));
// since it's now today's occurrence, it should show WITHOUT the non-today date label
ok("no stale date label shown now that it's today's own note", !M.innerHTML.includes("po-date"));

console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAILURES`);
process.exit(fail ? 1 : 0);
