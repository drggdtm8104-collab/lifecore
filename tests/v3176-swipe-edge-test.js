const fs = require("fs");
const vm = require("vm");
const path = require("path");

const src = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");

let fail = 0;
function ok(name, cond){
  if(cond){ console.log("PASS", name); } else { console.log("FAIL", name); fail++; }
}

function mkEl(id){
  const listeners = {};
  const el = {
    id, _html: "", value: "",
    classList: { add(){}, remove(){}, toggle(){}, contains(){return false;} },
    style: {}, dataset: {}, children: [],
    addEventListener(ev, fn){ (listeners[ev] = listeners[ev]||[]).push(fn); },
    querySelector(){ return mkEl(); },
    querySelectorAll(){ return []; },
    closest(){ return null; },
    appendChild(){}, focus(){}, remove(){}, click(){},
    get innerHTML(){ return this._html; },
    set innerHTML(v){ this._html = v; },
    getAttribute(){ return null; }, setAttribute(){},
    __listeners: listeners,
  };
  return el;
}

const documentListeners = {};
const elStore = { main: mkEl("main"), fab: mkEl(), fabMenu: mkEl() };

// v3.170のタッチ処理は、実際のDOM（M.querySelector）で上側タブの切替ボタンを
// 探してclick()する——このテスト用の簡易fakeDOMは文字列のinnerHTMLしか
// 持たないので、ここだけ「_htmlの中に該当ボタンがあるかどうか」を見て
// 本物同様の挙動を再現する。
elStore.main.querySelector = function(sel){
  const m = sel.match(/button\[data-act="([^"]+)"\]\[data-v="([^"]+)"\]/);
  if(!m) return null;
  const re = new RegExp(`data-act="${m[1]}"[^>]*data-v="${m[2]}"`);
  if(!re.test(this._html)) return null;
  const btn = mkEl();
  btn.dataset = { act: m[1], v: m[2] };
  btn.closest = function(s){ return s === "[data-act]" ? btn : null; };
  btn.click = function(){
    const handlers = documentListeners["click"] || [];
    handlers.forEach(fn=>fn({ target: btn, preventDefault(){}, stopPropagation(){} }));
  };
  return btn;
};

const fakeDocument = {
  addEventListener(ev, fn){ (documentListeners[ev] = documentListeners[ev]||[]).push(fn); },
  getElementById(id){ if(!elStore[id]) elStore[id] = mkEl(id); return elStore[id]; },
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
vm.runInContext(`globalThis.__t = { get db(){ return db; }, set db(v){ db=v; }, todayStr, renderToday, settings, state };`, sandbox);
const T = sandbox.__t;

(function(){
  const set = new Set();
  elStore.sheetWrap.classList = {
    add(c){ set.add(c); }, remove(c){ set.delete(c); },
    toggle(c){ set.has(c)?set.delete(c):set.add(c); }, contains(c){ return set.has(c); },
  };
})();

function touchStart(x, y){
  (elStore.main.__listeners["touchstart"]||[]).forEach(fn=>fn({ touches:[{clientX:x,clientY:y}] }));
}
function touchEnd(x, y){
  (elStore.main.__listeners["touchend"]||[]).forEach(fn=>fn({ changedTouches:[{clientX:x,clientY:y}] }));
}
function swipe(x1,y1,x2,y2){ touchStart(x1,y1); touchEnd(x2,y2); }

T.db.tasks = [];
T.db.occurrences = [];
T.db.notes = [];
T.db.remarks = [];
T.db.dayMeta = {};
T.db.settings = {};

// v3.176: 上側タブのスワイプ切替は、左右の端で止まる（一周して反対側に繋がらない）。

// --- 1. すでに一番右（list）にいるとき、さらに左へフリックしても変わらない ---
T.state.tab = "today";
T.state.todayView = "list";
T.renderToday();
swipe(300, 400, 220, 410);   // dx=-80 (左へ)
ok("swiping left while already on the last view (list) stays on list", T.state.todayView === "list");

// --- 2. すでに一番左（timeline）にいるとき、さらに右へフリックしても変わらない ---
T.state.tab = "today";
T.state.todayView = "timeline";
T.renderToday();
swipe(220, 400, 300, 410);   // dx=+80 (右へ)
ok("swiping right while already on the first view (timeline) stays on timeline", T.state.todayView === "timeline");

// --- 3. 左→左と連続でフリックしても、2周目で最初の画面に戻ったりしない ---
T.state.tab = "today";
T.state.todayView = "timeline";
T.renderToday();
swipe(300, 400, 220, 410);   // 1回目: timeline -> list
ok("first left swipe moves timeline -> list", T.state.todayView === "list");
T.renderToday();
swipe(300, 400, 220, 410);   // 2回目: list のままのはず（listより先はない）
ok("second consecutive left swipe does not wrap back to timeline", T.state.todayView === "list");

console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAILURES`);
process.exit(fail ? 1 : 0);
