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

// pre-seed localStorage with a "corrupted" DB: a single task with an OLD
// occurrence that has a progress note, and a NEWER (today's) occurrence that
// was already created with an empty note (simulating data from before the
// v3.101 carry-forward fix existed) — this is exactly the reported bug state.
let storedDb = null;
const sandbox = {
  document: fakeDocument, window: {}, console,
  localStorage: {
    getItem(k){ return k === "lifecore.v1" ? storedDb : null; },
    setItem(k,v){ if(k==="lifecore.v1") storedDb = v; },
    removeItem(k){ if(k==="lifecore.v1") storedDb = null; },
  },
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

// first pass: load the app once just to get todayStr()/addDays() and build a
// realistic seed-shaped DB with the exact broken pattern, matching the real
// on-disk storage key ("lifecore.v1" — verified against the source below).
const storageKeyMatch = src.match(/localStorage\.getItem\(["'`]([^"'`]+)["'`]\)/);
const STORAGE_KEY = storageKeyMatch ? storageKeyMatch[1] : "lifecore.v1";

try{
  vm.runInContext(src, sandbox, { filename: "app.js" });
}catch(e){
  console.log("SCRIPT THREW ON LOAD (pass 1):", e.message);
  process.exit(1);
}
vm.runInContext(`globalThis.__boot = { db, todayStr, addDays, uid };`, sandbox);
const boot = sandbox.__boot;

const task = boot.db.tasks.find(t=>t.kind==="single" && !t.done);
if(!task){ console.log("no open single task in seed data — cannot test"); process.exit(1); }

const yesterday = boot.addDays(boot.todayStr(), -1);
const oldOcc = { id: boot.uid(), taskId: task.id, date: yesterday, plannedStart:"09:00", plannedMin:30,
  status:"planned", note:"昨日はここまで進めた（修復前データ）", actualMin:null, doneAt:null, adhoc:false, plan:false };
const brokenTodayOcc = { id: boot.uid(), taskId: task.id, date: boot.todayStr(), plannedStart:null, plannedMin: task.estMin||null,
  status:"planned", note:"", actualMin:null, doneAt:null, adhoc:false, meal:false, title:null, plan:false };
boot.db.occurrences.push(oldOcc, brokenTodayOcc);

// write this "already broken" DB to localStorage exactly as the real app would,
// under whatever key the source actually uses
vm.runInContext(`localStorage.setItem(${JSON.stringify(STORAGE_KEY)}, JSON.stringify(db));`, sandbox);

// -------- second pass: fresh boot from this stored (broken) data, simulating
// the user reloading the app after the fix ships --------
const sandbox2 = {
  document: fakeDocument, window: {}, console,
  localStorage: sandbox.localStorage,   // reuse the same backing store
  navigator: { onLine: true, serviceWorker: undefined },
  fetch: async ()=>({ ok:false }),
  setTimeout, clearTimeout, setInterval, clearInterval,
  requestAnimationFrame: (fn)=>setTimeout(fn,0),
  history: { replaceState(){} },
  location: { hash:"", search:"", href:"http://localhost/" },
  alert: ()=>{}, confirm: ()=>true,
  Notification: undefined, visualViewport: undefined,
  performance: { now:()=>Date.now() },
  crypto: sandbox.crypto,
};
sandbox2.window = sandbox2;
sandbox2.globalThis = sandbox2;
sandbox2.addEventListener = function(){};
sandbox2.removeEventListener = function(){};
sandbox2.matchMedia = function(){ return { matches:false, addEventListener(){}, removeEventListener(){}, addListener(){}, removeListener(){} }; };
vm.createContext(sandbox2);
try{
  vm.runInContext(src, sandbox2, { filename: "app.js" });
}catch(e){
  console.log("SCRIPT THREW ON LOAD (pass 2, from stored broken data):", e.message);
  process.exit(1);
}
vm.runInContext(`globalThis.__after = { db, latestOccOf, todayStr };`, sandbox2);
const after = sandbox2.__after;

const healedTodayOcc = after.db.occurrences.find(o=>o.id===brokenTodayOcc.id);
ok("migrate() self-heal: previously-blank today occurrence now carries the old note", healedTodayOcc && healedTodayOcc.note === "昨日はここまで進めた（修復前データ）");
ok("latestOccOf now surfaces the healed note for the task", after.latestOccOf(task.id)?.note === "昨日はここまで進めた（修復前データ）");

// -------- idempotency: running migrate() again (e.g. next boot) shouldn't duplicate or break anything --------
vm.runInContext(`globalThis.__migrated2 = migrate(JSON.parse(JSON.stringify(db)));`, sandbox2);
const twice = sandbox2.__migrated2;
const stillHealed = twice.occurrences.find(o=>o.id===brokenTodayOcc.id);
ok("re-running migrate() is idempotent (note unchanged, no duplication)", stillHealed && stillHealed.note === "昨日はここまで進めた（修復前データ）");
ok("occurrence count unchanged after second migrate()", twice.occurrences.filter(o=>o.taskId===task.id && !o.plan).length === after.db.occurrences.filter(o=>o.taskId===task.id && !o.plan).length);

console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAILURES`);
process.exit(fail ? 1 : 0);
