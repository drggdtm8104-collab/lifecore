const fs = require("fs");
const vm = require("vm");
const path = require("path");

const src = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");

let fail = 0;
function ok(name, cond){
  if(cond){ console.log("PASS", name); } else { console.log("FAIL", name); fail++; }
}

// --- DOM mock ---
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
const fakeDocument = {
  addEventListener(ev, fn){ (documentListeners[ev] = documentListeners[ev]||[]).push(fn); },
  getElementById(id){
    if(id==="rmText"){ return fakeDocument.__rmText || (fakeDocument.__rmText = mkEl()); }
    return mkEl();
  },
  querySelector(){ return mkEl(); },
  querySelectorAll(){ return []; },
  createElement(){ return mkEl(); },
  body: mkEl(),
  documentElement: mkEl(),
};

const M = mkEl();
const FAB = mkEl();
const FABM = mkEl(); FABM.hidden = true;

const idMap = { main: M, fab: FAB, fabMenu: FABM };

fakeDocument.getElementById = function(id){
  if(idMap[id]) return idMap[id];
  if(id==="rmText"){ return fakeDocument.__rmText || (fakeDocument.__rmText = mkEl()); }
  return mkEl();
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
    render, byId: (typeof byId!=="undefined"?byId:null),
  };
`, sandbox);

const T = sandbox.__t;

// -------- Test 1: db.remarks exists and is independent from db.notes --------
ok("db.remarks is an array after boot", Array.isArray(T.db.remarks));
ok("db.remarks has seeded sample item", T.db.remarks.length >= 1);
ok("db.notes does not have pinned field on any item", !T.db.notes.some(n=>"pinned" in n));

// -------- Test 2: renderTasks default view is single, remarks not visible until switched --------
T.state.tab = "tasks";
T.state.tasksView = "single";
T.render();
ok("M.innerHTML mentions 完了型タスク seg button", M.innerHTML.includes("完了型タスク"));
ok("M.innerHTML mentions 覚え書き seg button", M.innerHTML.includes("覚え書き"));

// -------- Test 3: switch to remarks view via document click dispatch --------
// simulate case-switch handler directly by finding the click listeners
function dispatchClick(target){
  const handlers = documentListeners["click"] || [];
  const evt = { target, preventDefault(){}, stopPropagation(){} };
  handlers.forEach(fn=>fn(evt));
}

// Build a fake target that has closest() return itself when matching [data-act]
function fakeTarget(dataAct, dataV, dataId){
  const t = mkEl();
  t.dataset = { act: dataAct, v: dataV, id: dataId };
  t.closest = function(sel){
    if(sel === "[data-act]") return t;
    return null;
  };
  t.getAttribute = function(attr){
    if(attr==="data-act") return dataAct;
    if(attr==="data-v") return dataV;
    if(attr==="data-id") return dataId;
    return null;
  };
  return t;
}

dispatchClick(fakeTarget("tasks-view","remarks"));
ok("state.tasksView becomes 'remarks' after clicking seg button", T.state.tasksView === "remarks");
T.render();
ok("remarks view lists seeded remark text", M.innerHTML.includes("常に継続でも単発でもない"));
ok("remark rendered as button with edit-remark data-act", M.innerHTML.includes('data-act="edit-remark"'));

// -------- Test 4: add a new remark via save-remark case --------
const beforeCount = T.db.remarks.length;
fakeDocument.__rmText = mkEl();
fakeDocument.__rmText.value = "テスト用の新しい覚え書き";
dispatchClick(fakeTarget("save-remark", null, null));
ok("db.remarks grew by 1 after save-remark with no id", T.db.remarks.length === beforeCount + 1);
ok("new remark text matches input", T.db.remarks[0].text === "テスト用の新しい覚え書き");

// -------- Test 5: edit existing remark via save-remark with id --------
const targetId = T.db.remarks[0].id;
fakeDocument.__rmText = mkEl();
fakeDocument.__rmText.value = "編集後のテキスト";
dispatchClick(fakeTarget("save-remark", null, targetId));
ok("existing remark text updated", T.db.remarks.find(r=>r.id===targetId).text === "編集後のテキスト");

// -------- Test 6: delete remark --------
const countBeforeDel = T.db.remarks.length;
// del-remark uses askConfirm -> need to check askConfirm is stubbed to auto-confirm
// find askConfirm in sandbox and monkey-patch if needed
vm.runInContext(`
  askConfirm = function(msg, cb){ cb(); };
`, sandbox);
dispatchClick(fakeTarget("del-remark", null, targetId));
ok("db.remarks shrank by 1 after del-remark", T.db.remarks.length === countBeforeDel - 1);

// -------- Test 7: FAB routes to sheetRemark when tasksView is remarks --------
let sheetOpenedWith = null;
vm.runInContext(`
  sheetRemark = function(id){ globalThis.__sheetRemarkCalledWith = id; };
  sheetTask = function(id){ globalThis.__sheetTaskCalledWith = id; };
`, sandbox);
T.state.tab = "tasks";
T.state.tasksView = "remarks";
const fabHandlers = FAB.__listeners["click"] || [];
fabHandlers.forEach(fn=>fn({}));
vm.runInContext(`globalThis.__check1 = (typeof __sheetRemarkCalledWith !== "undefined");`, sandbox);
ok("sheetRemark was invoked by FAB", sandbox.__check1 === true);

T.state.tasksView = "single";
vm.runInContext(`delete globalThis.__sheetTaskCalledWith;`, sandbox);
fabHandlers.forEach(fn=>fn({}));
vm.runInContext(`globalThis.__check2 = (typeof __sheetTaskCalledWith !== "undefined");`, sandbox);
ok("sheetTask was invoked by FAB when tasksView=single", sandbox.__check2 === true);

// -------- Test 8: no toast on boot for sample data (dbg used instead) --------
// We can't easily re-run boot here, but verify the source no longer calls toast(...) inside the localIsSample branch.
ok("source no longer has intrusive boot toast for localIsSample", !src.includes('toast("この端末に保存データが見つからなかったため'));
ok("source uses dbg() for localIsSample diagnostic", /local was sample/.test(src));

// -------- Test 9: tabbar has 4 tabs, no remarks bottom tab, no separate insights tab --------
// 傾向タブはその後さらに履歴タブへ統合され（state.histView切替）、独立した
// bottomタブではなくなった。現在の正しいタブ構成（today/tasks/history/notes
// の4つ）に合わせて期待値を更新した。
ok("no remarks bottom tab label in TAB label map", !src.includes('remarks:"覚え書き"'));
ok("renderTabbar array has exactly 4 tab entries (insights merged into history)", /\["today","スケジュール"\],\["tasks","タスク"\],\["history","履歴"\],\["notes","メモ"\]\]/.test(src));

console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAILURES`);
process.exit(fail ? 1 : 0);
