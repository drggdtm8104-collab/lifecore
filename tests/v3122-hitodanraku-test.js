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
    _html: "", value: "", checked: true,
    classList: { add(){}, remove(){}, toggle(){}, contains(){return false;} },
    style: {}, dataset: {}, children: [],
    addEventListener(ev, fn){ (listeners[ev] = listeners[ev]||[]).push(fn); },
    querySelector(sel){
      if(sel === '[data-f="sel"]') return this._checkboxEl || (this._checkboxEl = mkCheckbox(this));
      return mkEl();
    },
    querySelectorAll(){ return []; },
    closest(){ return null; },
    appendChild(){}, remove(){}, focus(){}, select(){}, click(){},
    get innerHTML(){ return this._html; },
    set innerHTML(v){ this._html = v; },
    getAttribute(){ return null; }, setAttribute(){},
    __listeners: listeners,
  };
  return el;
}
function mkCheckbox(parent){
  const cb = mkEl();
  cb.checked = true;
  return cb;
}

const documentListeners = {};
const elStore = {};

const fakeDocument = {
  addEventListener(ev, fn){ (documentListeners[ev] = documentListeners[ev]||[]).push(fn); },
  getElementById(id){ if(!elStore[id]) elStore[id] = mkEl(); return elStore[id]; },
  querySelector(){ return mkEl(); },
  querySelectorAll(sel){
    if(sel === "#hdList .hd-cand") return fakeDocument.__hdCandRows || [];
    return [];
  },
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
  navigator: { onLine: true },
  fetch: async ()=>({ ok: true, status: 200, json: async()=>({ok:true}) }),
  setTimeout, clearTimeout, setInterval, clearInterval,
  requestAnimationFrame: (fn)=>setTimeout(fn,0),
  history: { replaceState(){} },
  location: { hash:"", search:"", href:"http://localhost/" },
  alert: ()=>{}, confirm: ()=>true,
  isSecureContext: true,
  visualViewport: undefined,
  performance: { now:()=>Date.now() },
  crypto: require("crypto").webcrypto || {
    randomUUID(){ return require("crypto").randomUUID(); },
    getRandomValues(arr){ return require("crypto").randomFillSync(arr); },
  },
  atob: (s) => Buffer.from(s, "base64").toString("binary"),
  Blob: function(parts, opts){ this.parts = parts; this.type = opts && opts.type; },
  URL: { createObjectURL(){ return "blob:fake"; }, revokeObjectURL(){} },
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
vm.runInContext(`globalThis.__t = {
  get db(){ return db; }, set db(v){ db=v; },
  get state(){ return state; }, render,
  freeGapsFrom, skillBacklog, planHitodanraku, keyToTime, timeKey, addDays,
  HD_BEDTIME_KEY, HD_DEFAULT_MIN,
};`, sandbox);
const T = sandbox.__t;

function dispatchClick(dataAct, dataV, dataId){
  const t = mkEl();
  t.dataset = { act: dataAct, v: dataV, id: dataId };
  t.closest = function(sel){ if(sel === "[data-act]") return t; return null; };
  const handlers = documentListeners["click"] || [];
  const evt = { target: t, preventDefault(){}, stopPropagation(){} };
  handlers.forEach(fn=>fn(evt));
}

const today = T.timeKey ? (function(){
  // use the app's own todayStr via a tiny detour: schedule day string is exposed indirectly.
  // simplest: read today's date the same way todaysTimedTasks etc. do, via a direct call.
  return null;
})() : null;

vm.runInContext(`globalThis.__today = todayStr();`, sandbox);
const TODAY = sandbox.__today;

// ============================================================
// freeGapsFrom()
// ============================================================
T.db.occurrences = [];
T.db.tasks = [];

// Test 1: no occurrences at all -> whole range is one gap
let gaps = T.freeGapsFrom(TODAY, 1000, 1100);
ok("no occupied time -> the whole range is a single gap", gaps.length===1 && gaps[0].start===1000 && gaps[0].end===1100);

// Test 2: one band splits into two gaps
T.db.occurrences = [
  { id:"b1", date:TODAY, plannedStart:"18:00", plannedMin:30, status:"planned" },   // 1080-1110
];
gaps = T.freeGapsFrom(TODAY, 1000, 1200);
ok("a single occupied band splits the range into two gaps", gaps.length===2 && gaps[0].end===1080 && gaps[1].start===1110);

// Test 3: adjacent/overlapping bands get merged
T.db.occurrences = [
  { id:"b1", date:TODAY, plannedStart:"18:00", plannedMin:30, status:"planned" },   // 1080-1110
  { id:"b2", date:TODAY, plannedStart:"18:20", plannedMin:20, status:"planned" },   // 1100-1120, overlaps b1
];
gaps = T.freeGapsFrom(TODAY, 1000, 1200);
ok("overlapping bands are merged into one occupied span", gaps.length===2 && gaps[0].end===1080 && gaps[1].start===1120);

// Test 4: deferred occurrences are not treated as occupied
T.db.occurrences = [
  { id:"b1", date:TODAY, plannedStart:"18:00", plannedMin:30, status:"deferred" },
];
gaps = T.freeGapsFrom(TODAY, 1000, 1200);
ok("a deferred occurrence does not occupy time", gaps.length===1 && gaps[0].start===1000 && gaps[0].end===1200);

// Test 5: fromKey >= untilKey -> empty
ok("fromKey at/after untilKey returns no gaps", T.freeGapsFrom(TODAY, 1200, 1200).length===0);

// Test 6: a plan block marked freeBlock:true does not occupy time (v3.123 fix —
// e.g. a template's "自由時間" placeholder block should not block ひと段落's proposals)
T.db.occurrences = [
  { id:"b1", date:TODAY, plan:true, plannedStart:"18:00", plannedMin:120, status:"plan", freeBlock:true },
];
gaps = T.freeGapsFrom(TODAY, 1000, 1200);
ok("a freeBlock:true plan occurrence does not occupy time", gaps.length===1 && gaps[0].start===1000 && gaps[0].end===1200);

// Test 7: a freeBlock alongside a real (non-free) block only excludes the free one
T.db.occurrences = [
  { id:"b1", date:TODAY, plan:true, plannedStart:"18:00", plannedMin:30, status:"plan", freeBlock:true },   // 1080-1110, ignored
  { id:"b2", date:TODAY, plannedStart:"19:00", plannedMin:30, status:"planned" },                             // 1140-1170, real
];
gaps = T.freeGapsFrom(TODAY, 1000, 1200);
ok("a freeBlock plan is excluded while a real occupied block still splits the range", gaps.length===2 && gaps[0].end===1140 && gaps[1].start===1170);

// ============================================================
// skillBacklog()
// ============================================================
T.db.occurrences = [];
const perWeekTask = { id:"pw1", kind:"repeat", rtype:"skill", freq:{type:"perWeek", n:3}, estMin:20 };
ok("perWeek task with zero completions this week has full backlog", T.skillBacklog(perWeekTask, TODAY) === 3);

T.db.occurrences = [
  { id:"o1", taskId:"pw1", date:TODAY, status:"done" },
  { id:"o2", taskId:"pw1", date:TODAY, status:"done" },
  { id:"o3", taskId:"pw1", date:TODAY, status:"done" },
];
ok("perWeek task that already met its weekly target has zero backlog", T.skillBacklog(perWeekTask, TODAY) === 0);

const dailyTask = { id:"d1", kind:"repeat", rtype:"skill", freq:{type:"daily"}, estMin:15 };
T.db.occurrences = [];
ok("daily task with no completions in the last 7 days has backlog 7", T.skillBacklog(dailyTask, TODAY) === 7);

T.db.occurrences = [1,2,3,4,5,6,7].map(i => ({ id:"h"+i, taskId:"d1", date: T.addDays(TODAY, -i), status:"done" }));
ok("daily task done every day for the last 7 days has backlog 0", T.skillBacklog(dailyTask, TODAY) === 0);

// ============================================================
// planHitodanraku()
// ============================================================
T.db.tasks = [
  { id:"skillA", name:"スキルA", kind:"repeat", rtype:"skill", freq:{type:"daily"}, estMin:30, createdAt:"1" },
  { id:"skillB", name:"スキルB", kind:"repeat", rtype:"skill", freq:{type:"daily"}, estMin:20, createdAt:"2" },
  { id:"routineC", name:"ルーティンC", kind:"repeat", rtype:"routine", freq:{type:"daily"}, estMin:10, createdAt:"3" },
  { id:"skillNoEst", name:"見積なしスキル", kind:"repeat", rtype:"skill", freq:{type:"daily"}, createdAt:"4" },
];
// skillA has never been done -> backlog 7 (most urgent); skillB done recently -> lower backlog
T.db.occurrences = [
  { id:"h1", taskId:"skillB", date: T.addDays(TODAY,-1), status:"done" },
  { id:"h2", taskId:"skillB", date: T.addDays(TODAY,-2), status:"done" },
  { id:"h3", taskId:"skillB", date: T.addDays(TODAY,-3), status:"done" },
  { id:"h4", taskId:"skillB", date: T.addDays(TODAY,-4), status:"done" },
  { id:"h5", taskId:"skillB", date: T.addDays(TODAY,-5), status:"done" },
];

let result = T.planHitodanraku(TODAY, T.timeKey("19:00"));
ok("most-behind skill task (skillA) is placed first, at the start of the window", result.plan.length>=1 && result.plan[0].task.id==="skillA" && result.plan[0].start==="19:00");
ok("routine-type tasks are never proposed even if behind", !result.plan.some(p=>p.task.id==="routineC"));
ok("a skill task with no estMin falls back to HD_DEFAULT_MIN", (function(){
  const withNoEst = result.plan.find(p=>p.task.id==="skillNoEst");
  return !withNoEst || withNoEst.min === T.HD_DEFAULT_MIN;
})());

// candidate exclusion: a task with a still-pending (planned) occurrence today is excluded,
// but one that's already done today (with nothing pending) is NOT excluded.
T.db.occurrences.push({ id:"pend1", taskId:"skillA", date:TODAY, status:"planned" });
result = T.planHitodanraku(TODAY, T.timeKey("19:00"));
ok("a skill task with a pending (not-yet-done) occurrence today is excluded from candidates", !result.plan.some(p=>p.task.id==="skillA"));

T.db.occurrences = T.db.occurrences.filter(o=>o.id!=="pend1");
T.db.occurrences.push({ id:"done1", taskId:"skillA", date:TODAY, status:"done" });
result = T.planHitodanraku(TODAY, T.timeKey("19:00"));
ok("a skill task already done today (nothing pending) is still eligible for re-suggestion", result.plan.some(p=>p.task.id==="skillA"));

// tasks that don't fit anywhere are skipped, not force-placed
T.db.occurrences = [];
result = T.planHitodanraku(TODAY, T.timeKey("24:50"));   // only 10 min until 25:00
ok("a candidate that doesn't fit in the remaining window is skipped, not placed", !result.plan.some(p=>p.min > (25*60 - T.timeKey("24:50"))));

// past bedtime -> nothing
result = T.planHitodanraku(TODAY, T.HD_BEDTIME_KEY);
ok("calling at/after bedtime yields no gaps and no plan", result.gaps.length===0 && result.plan.length===0);

console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAILURES`);
process.exit(fail ? 1 : 0);
