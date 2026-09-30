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

// track the "on" button per radio-row so querySelector("#id button.on") works
const radioOn = {};
const fakeDocument = {
  addEventListener(ev, fn){ (documentListeners[ev] = documentListeners[ev]||[]).push(fn); },
  getElementById(id){ if(!elStore[id]) elStore[id] = mkEl(); return elStore[id]; },
  querySelector(sel){
    const m = sel.match(/^#(\S+)\s+button\.on$/);
    if(m && radioOn[m[1]]) return radioOn[m[1]];
    return mkEl();
  },
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
    render, todayStr, addDays, remarkInPeriod, byRemarkShow,
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

// -------- Test 1: migrate() default fields on existing seeded remark --------
const seededRemark = T.db.remarks[0];
ok("seeded remark has prio defaulted to 'low'", seededRemark.prio === "low");
ok("seeded remark has showFrom/showTo defaulted to null", seededRemark.showFrom === null && seededRemark.showTo === null);

// -------- Test 2: remarkInPeriod logic --------
const T0 = T.todayStr();
const past = T.addDays(T0, -10), past2 = T.addDays(T0, -5);
const future = T.addDays(T0, 10), future2 = T.addDays(T0, 20);
ok("no period set => always in period", T.remarkInPeriod({showFrom:null, showTo:null}));
ok("in period: today within [past, future]", T.remarkInPeriod({showFrom:past, showTo:future}));
ok("out of period: showTo already passed", !T.remarkInPeriod({showFrom:past2, showTo:past}));
ok("out of period: showFrom not yet reached", !T.remarkInPeriod({showFrom:future, showTo:future2}));
ok("in period: only showFrom set, already started", T.remarkInPeriod({showFrom:past, showTo:null}));
ok("in period: only showTo set, not yet expired", T.remarkInPeriod({showFrom:null, showTo:future}));

// -------- Test 3: byRemarkShow sort order (in-period first, then by prio; out-of-period last) --------
const rHighOut = { text:"high-out", prio:"high", showFrom:past2, showTo:past };
const rLowIn   = { text:"low-in",   prio:"low",  showFrom:null,  showTo:null };
const rMidIn   = { text:"mid-in",   prio:"mid",  showFrom:null,  showTo:null };
const rHighIn  = { text:"high-in",  prio:"high", showFrom:null,  showTo:null };
const sorted = [rHighOut, rLowIn, rMidIn, rHighIn].sort(T.byRemarkShow).map(x=>x.text);
ok("in-period items sorted before out-of-period, and by prio within group",
  JSON.stringify(sorted) === JSON.stringify(["high-in","mid-in","low-in","high-out"]));

// -------- Test 4: renderTasks shows prio chip and period label, dims out-of-period item --------
T.db.remarks = [
  { id:"r1", text:"重要な覚え書き", prio:"high", showFrom:null, showTo:null, createdAt:"", updatedAt:"" },
  { id:"r2", text:"期限切れの覚え書き", prio:"low", showFrom:past2, showTo:past, createdAt:"", updatedAt:"" },
];
T.state.tab = "tasks";
T.state.tasksView = "remarks";
T.render();
ok("high-prio remark's chip rendered (重要 高)", M.innerHTML.includes("重要 高"));
ok("out-of-period remark shows period label", M.innerHTML.includes("表示期間:"));
ok("out-of-period remark gets the dimmed class", M.innerHTML.includes("rm-dim"));
// order check: r1 (in period) should appear before r2 (out of period) in the HTML
ok("in-period remark appears before out-of-period remark in rendered HTML",
  M.innerHTML.indexOf("重要な覚え書き") < M.innerHTML.indexOf("期限切れの覚え書き"));

// -------- Test 5: sheetRemark renders 重要度 radio-row and 表示期間 date inputs --------
vm.runInContext(`openSheet = function(html){ globalThis.__lastSheet = html; };`, sandbox);
dispatchClick(fakeTarget("edit-remark", null, "r1"));
vm.runInContext(`globalThis.__sheetCheck = __lastSheet;`, sandbox);
const sheetHtml = sandbox.__sheetCheck || "";
ok("sheetRemark includes 重要度 radio-row (rmPrio) reflecting current prio=high", sheetHtml.includes('id="rmPrio"') && /data-v="high" class="on"/.test(sheetHtml));
ok("sheetRemark includes 表示期間 date inputs (rmFrom/rmTo)", sheetHtml.includes('id="rmFrom"') && sheetHtml.includes('id="rmTo"'));

// -------- Test 6: save-remark persists prio + period --------
elStore["rmText"] = mkEl(); elStore["rmText"].value = "重要な覚え書き";
const prioBtn = mkEl(); prioBtn.dataset = { v: "mid" };
radioOn["rmPrio"] = prioBtn;
elStore["rmFrom"] = mkEl(); elStore["rmFrom"].value = T0;
elStore["rmTo"] = mkEl(); elStore["rmTo"].value = future;
dispatchClick(fakeTarget("save-remark", null, "r1"));
const savedR1 = T.db.remarks.find(r=>r.id==="r1");
ok("save-remark updates prio", savedR1.prio === "mid");
ok("save-remark updates showFrom/showTo", savedR1.showFrom === T0 && savedR1.showTo === future);

// -------- Test 7: rm-clear-period clears both date fields --------
dispatchClick(fakeTarget("edit-remark", null, "r1"));
elStore["rmFrom"].value = T0;
elStore["rmTo"].value = future;
dispatchClick(fakeTarget("rm-clear-period"));
ok("rm-clear-period clears rmFrom", elStore["rmFrom"].value === "");
ok("rm-clear-period clears rmTo", elStore["rmTo"].value === "");

console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAILURES`);
process.exit(fail ? 1 : 0);
