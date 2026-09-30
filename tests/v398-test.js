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
    _html: "",
    classList: { add(){}, remove(){}, toggle(){}, contains(){return false;} },
    style: {},
    dataset: {},
    children: [],
    addEventListener(ev, fn){ (listeners[ev] = listeners[ev]||[]).push(fn); },
    querySelector(){ return mkEl(); },
    querySelectorAll(){ return []; },
    closest(){ return null; },
    appendChild(){},
    focus(){},
    get innerHTML(){ return this._html; },
    set innerHTML(v){ this._html = v; },
    getAttribute(){ return null; },
    setAttribute(){},
    remove(){},
    __listeners: listeners,
  };
  return el;
}

const documentListeners = {};
const M = mkEl();
const FAB = mkEl();
const FABM = mkEl(); FABM.hidden = true;
const idMap = { main: M, fab: FAB, fabMenu: FABM };

const fakeDocument = {
  addEventListener(ev, fn){ (documentListeners[ev] = documentListeners[ev]||[]).push(fn); },
  getElementById(id){ if(idMap[id]) return idMap[id]; return mkEl(); },
  querySelector(){ return mkEl(); },
  querySelectorAll(){ return []; },
  createElement(){ return mkEl(); },
  body: mkEl(),
  documentElement: mkEl(),
};

const sandbox = {
  document: fakeDocument,
  window: {},
  console,
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
  Notification: undefined,
  visualViewport: undefined,
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
    get db(){ return db; },
    set db(v){ db = v; },
    get state(){ return state; },
    render,
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

// -------- Test 1: default state, bottom tabbar has 4 tabs, no 'insights' tab entry --------
T.state.tab = "today";
T.render();
ok("state.histView defaults to 'records'", T.state.histView === "records");
ok("no top-level 'insights' tab branch in source", !src.includes('state.tab==="insights"'));
ok("renderTabbar array has 4 entries (today/tasks/history/notes)", /\["today","スケジュール"\],\["tasks","タスク"\],\["history","履歴"\],\["notes","メモ"\]/.test(src));
ok("no insights entry in TAB_ICONS", !/insights:`<svg/.test(src));
ok("header label map no longer has insights", !src.includes('insights:"傾向"'));

// -------- Test 2: history tab default view shows records (day/week/month) segment --------
T.state.tab = "history";
T.state.histView = "records";
T.render();
ok("records view shows 記録/傾向 switch segment", M.innerHTML.includes("記録") && M.innerHTML.includes(">傾向<"));
ok("records view shows day/week/month segment (日)", M.innerHTML.includes(">日<"));

// -------- Test 3: switching to insights via click shows insights content, no day/week/month --------
dispatchClick(fakeTarget("hist-view","insights"));
ok("state.histView becomes 'insights' after click", T.state.histView === "insights");
ok("insights view shows the intro text", M.innerHTML.includes("傾向を学習しています"));
ok("insights view does NOT show the day/week/month span segment", !M.innerHTML.includes('data-act="span"'));
ok("insights view still shows the 記録/傾向 switch segment", M.innerHTML.includes('data-act="hist-view"'));

// -------- Test 4: switch back to records --------
dispatchClick(fakeTarget("hist-view","records"));
ok("state.histView back to 'records'", T.state.histView === "records");
ok("records view content restored (hist-nav present)", M.innerHTML.includes("hist-nav"));

// -------- Test 5: FAB stays hidden on history tab regardless of sub-view --------
T.state.tab = "history"; T.state.histView = "records"; T.render();
ok("FAB hidden on history/records", FAB.hidden === true);
T.state.histView = "insights"; T.render();
ok("FAB hidden on history/insights", FAB.hidden === true);

// -------- Test 6: CSS grid updated to 4 columns --------
const cssBlock = fs.readFileSync("C:\\Users\\hirom\\Claude\\LifeCore\\app\\index.html", "utf8");
ok("tabbar CSS grid is 4 columns", cssBlock.includes("grid-template-columns:repeat(4,1fr)"));

console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAILURES`);
process.exit(fail ? 1 : 0);
