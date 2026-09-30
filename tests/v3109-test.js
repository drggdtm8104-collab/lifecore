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
const tpl = T.db.templates[0];
ok("seed has at least one template with plans+tasks", !!tpl && (tpl.plans||[]).length && (tpl.tasks||[]).length);

// -------- Test 1: re-applying the SAME template to the same day twice must not duplicate anything --------
T.applyTemplate(today, tpl.id);
const countAfterFirst = T.db.occurrences.filter(o=>o.date===today).length;
T.applyTemplate(today, tpl.id);
const countAfterSecond = T.db.occurrences.filter(o=>o.date===today).length;
ok("re-applying the same template twice does not change the occurrence count", countAfterFirst === countAfterSecond);

// -------- Test 2: marking a task occurrence "done", then re-applying, must NOT create a duplicate --------
const someOcc = T.db.occurrences.find(o=>o.date===today && !o.plan && o.taskId===tpl.tasks[0].taskId);
ok("found a task occurrence created by the template to mark done", !!someOcc);
someOcc.status = "done"; someOcc.doneAt = new Date().toISOString(); someOcc.actualMin = 5;
const countBeforeReapply = T.db.occurrences.filter(o=>o.date===today).length;
T.applyTemplate(today, tpl.id);
const countAfterReapplyWithDone = T.db.occurrences.filter(o=>o.date===today).length;
ok("re-applying after marking one occurrence done does not create a duplicate (this was the bug)", countAfterReapplyWithDone === countBeforeReapply);
const stillDone = T.db.occurrences.find(o=>o.id===someOcc.id);
ok("the done occurrence's completion record is untouched (status/actualMin preserved)", stillDone && stillDone.status==="done" && stillDone.actualMin===5);

// -------- Test 3: plan/marker occurrences (起床/仕事 etc.) also don't duplicate on re-apply, and keep the same ids --------
const planIdsBefore = T.db.occurrences.filter(o=>o.date===today && o.plan && o.fromTpl).map(o=>o.id).sort();
T.applyTemplate(today, tpl.id);
const planIdsAfter = T.db.occurrences.filter(o=>o.date===today && o.plan && o.fromTpl).map(o=>o.id).sort();
ok("plan/marker occurrence ids are stable across re-application (no new ids minted)", JSON.stringify(planIdsBefore) === JSON.stringify(planIdsAfter));
ok("plan/marker occurrence count for today matches the template's plan row count", planIdsAfter.length === (tpl.plans||[]).length);

console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAILURES`);
process.exit(fail ? 1 : 0);
