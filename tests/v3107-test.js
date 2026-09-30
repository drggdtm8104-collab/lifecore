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
    render,
  };
  askConfirm = function(msg, cb){ cb(); };
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

// -------- Test 1: UI no longer has the old single "do-import" action --------
ok("source no longer defines case \"do-import\":", !src.includes('case "do-import":'));
ok("source defines the new merge/replace cases", src.includes('case "do-import-merge"') && src.includes('case "do-import-replace"'));

// -------- Test 2: merge import keeps device-only items from BOTH sides --------
const localOnlyTask = { id:"local-only", kind:"single", name:"この端末だけのタスク", done:false, createdAt:"2026-01-01" };
T.db.tasks.push(localOnlyTask);
const importedOnlyTask = { id:"imported-only", kind:"single", name:"貼り付け側だけのタスク", done:false, createdAt:"2026-01-02" };

// build a plausible exported JSON representing "the other device"
const exportedDb = JSON.parse(JSON.stringify(T.db));
exportedDb.tasks = exportedDb.tasks.filter(t=>t.id!=="local-only"); // other device never had this
exportedDb.tasks.push(importedOnlyTask);
// simulate a conflicting edit: same task id changed differently on both sides
const sharedId = T.db.tasks[0].id;
const localTask = T.db.tasks.find(t=>t.id===sharedId);
localTask.name = "ローカルでの編集";
const exportedSharedTask = exportedDb.tasks.find(t=>t.id===sharedId);
exportedSharedTask.name = "貼り付け側での編集";

elStore["importBox"] = mkEl();
elStore["importBox"].value = JSON.stringify(exportedDb);
dispatchClick(fakeTarget("do-import-merge"));

ok("merge keeps the local-only task", T.db.tasks.some(t=>t.id==="local-only"));
ok("merge keeps the imported-only task", T.db.tasks.some(t=>t.id==="imported-only"));
ok("merge resolves the same-id conflict in favor of the imported (pasted) side",
  T.db.tasks.find(t=>t.id===sharedId).name === "貼り付け側での編集");

// -------- Test 3: replace import wipes local-only data, keeps only imported content --------
elStore["importBox"] = mkEl();
elStore["importBox"].value = JSON.stringify(exportedDb);
dispatchClick(fakeTarget("do-import-replace"));
ok("replace removes the local-only task (it wasn't in the imported JSON)", !T.db.tasks.some(t=>t.id==="local-only"));
ok("replace keeps the imported-only task", T.db.tasks.some(t=>t.id==="imported-only"));

console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAILURES`);
process.exit(fail ? 1 : 0);
