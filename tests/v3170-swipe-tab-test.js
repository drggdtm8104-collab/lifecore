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
// 本物同様の挙動（見つかれば既存のクリック処理を本当に実行、無ければ
// 何もしない）を再現する。
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
vm.runInContext(`globalThis.__t = { get db(){ return db; }, set db(v){ db=v; }, todayStr, renderToday, renderNotes, settings, state };`, sandbox);
const T = sandbox.__t;
const today = T.todayStr();

// classListをちゃんと状態を持つ実装に差し替える（sheetWrapの"open"判定に使う）
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

// --- 1. 今日タブ: 左へフリックでタイムテーブル→ToDoリストに切り替わる ---
T.state.tab = "today";
T.state.todayView = "timeline";
T.renderToday();
swipe(300, 400, 220, 410);   // dx=-80 (左へ), dy=10
ok("swiping left on 今日タブ switches timeline -> list", T.state.todayView === "list");

// --- 2. 右へフリックで戻る ---
T.renderToday();
swipe(220, 400, 300, 410);   // dx=+80 (右へ)
ok("swiping right on 今日タブ switches list -> timeline", T.state.todayView === "timeline");

// --- 3. 横移動が小さいときは切り替わらない ---
T.renderToday();
swipe(300, 400, 270, 405);   // dx=-30, 60px未満
ok("a short swipe (under 60px) does not switch the view", T.state.todayView === "timeline");

// --- 4. 縦方向優勢（スクロール）のときは切り替わらない ---
T.renderToday();
swipe(300, 400, 260, 520);   // dx=-40, dy=120 (縦のほうがずっと大きい)
ok("a mostly-vertical drag (scrolling) does not switch the view", T.state.todayView === "timeline");

// --- 5. シートが開いている間はスワイプを無視する ---
T.renderToday();
elStore.sheetWrap.classList.add("open");
swipe(300, 400, 200, 405);
ok("a swipe while a sheet is open does not switch the view", T.state.todayView === "timeline");
elStore.sheetWrap.classList.remove("open");

// --- 6. メモタブ: メモを編集中（切替ボタン自体が無い）ときは何もしない ---
T.state.tab = "notes";
T.state.notesView = "notes";
T.db.notes = [{ id:"n1", title:"test", body:"", createdAt:today, updatedAt:today }];
T.state.noteId = "n1";
T.renderNotes();
ok("sanity: the view-toggle buttons are not in the note editor's HTML", !elStore.main._html.includes('data-act="notes-view"'));
swipe(300, 400, 220, 405);
ok("swiping while editing a note does not touch notesView", T.state.notesView === "notes");

// --- 7. メモタブ一覧: 覚え書き<->メモの切替もスワイプで動く ---
T.state.noteId = null;
T.state.notesView = "notes";
T.renderNotes();
swipe(300, 400, 220, 405);   // 左へ: メモ(notes) -> 覚え書き(remarks)
ok("swiping left in the notes list switches notes -> remarks", T.state.notesView === "remarks");

console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAILURES`);
process.exit(fail ? 1 : 0);
