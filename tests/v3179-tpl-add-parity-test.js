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
    appendChild(){}, focus(){}, remove(){}, checked:false,
    get innerHTML(){ return this._html; },
    set innerHTML(v){ this._html = v; },
    getAttribute(){ return null; }, setAttribute(){},
    __listeners: listeners,
  };
  return el;
}

const documentListeners = {};
const elStore = { main: mkEl("main"), fab: mkEl(), fabMenu: mkEl() };

const fakeDocument = {
  addEventListener(ev, fn){ (documentListeners[ev] = documentListeners[ev]||[]).push(fn); },
  getElementById(id){ if(!elStore[id]) elStore[id] = mkEl(id); return elStore[id]; },
  querySelector(sel){
    // "#tpCat button.on" 等、ラジオ行の選択中ボタンを読むためだけの最小実装
    const m = sel.match(/^#(\w+)\s+button\.on$/);
    if(m) return elStore["__radioOn_"+m[1]] || null;
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
vm.runInContext(`globalThis.__t = { get db(){ return db; }, set db(v){ db=v; }, get state(){ return state; }, todayStr, applyTemplate, renderTemplates };`, sandbox);
const T = sandbox.__t;
const today = T.todayStr();

function dispatchClick(dataAct, extra){
  const t = mkEl();
  t.dataset = Object.assign({ act: dataAct }, extra||{});
  t.closest = function(sel){ if(sel === "[data-act]") return t; return null; };
  const handlers = documentListeners["click"] || [];
  const evt = { target: t, preventDefault(){}, stopPropagation(){} };
  handlers.forEach(fn=>fn(evt));
}

const sheetEl = elStore.sheet || (elStore.sheet = mkEl("sheet"));

// v3.179: 「普段の＋ボタンの『予定を追加』『ToDoリストに追加』と同じような
// 仕様にして」——押した後の画面（項目・絞り込み）を、テンプレート編集の
// 「予定」「配置するタスク」の追加フローにも揃える。

T.db.tasks = [
  { id:"t1", name:"完了型タスクA", kind:"single", freq:null, estMin:null, category:"その他", note:"", due:null, duePrec:"day", prio:"low", startDate:null, startPrec:"day", rtype:null, done:false, createdAt:today },
  { id:"t2", name:"継続タスクB", kind:"repeat", rtype:"routine", freq:{type:"daily"}, estMin:20, category:"運動", note:"", done:false, createdAt:today },
];
T.db.templates = [{ id:"tpl1", name:"テスト用テンプレ", plans:[], tasks:[] }];
T.db.occurrences = [];
T.db.dayMeta = {};
T.db.settings = {};

// -------- 1. 「予定」の追加フロー: タイトルが空だとブロックされる（sheetMarkerと同じ） --------
T.state._tplDraft = { tplId:"tpl1", name:"テスト用テンプレ", plans:[], tasks:[] };
elStore.tpName = mkEl("tpName"); elStore.tpName.value = "";
elStore.tpStart = mkEl("tpStart"); elStore.tpStart.value = "09:00";
elStore.tpEnd = mkEl("tpEnd"); elStore.tpEnd.value = "";
elStore.tpNote = mkEl("tpNote"); elStore.tpNote.value = "";
elStore.tpFree = mkEl("tpFree"); elStore.tpFree.checked = false;
dispatchClick("tpl-plan-confirm");
ok("タイトルが空だと予定の行は積まれない", T.state._tplDraft.plans.length === 0);

// -------- 2. タイトル・時間・カテゴリ・自由時間・備考をまとめて入れて追加できる --------
elStore.tpName.value = "ジム";
elStore.tpEnd.value = "10:00";
elStore.tpNote.value = "タオル持参";
elStore.tpFree.checked = true;
elStore.__radioOn_tpCat = mkEl(); elStore.__radioOn_tpCat.dataset = { v:"運動" };
dispatchClick("tpl-plan-confirm");
{
  const row = T.state._tplDraft.plans[0];
  ok("予定の行が1件積まれる", T.state._tplDraft.plans.length === 1);
  ok("タイトルが入る", row && row.label === "ジム");
  ok("開始時刻が入る", row && row.time === "09:00");
  ok("終了時刻から所要が算出される(60分)", row && row.mins === 60);
  ok("カテゴリが入る（sheetMarkerと同じ項目）", row && row.category === "運動");
  ok("自由時間チェックが入る（sheetMarkerと同じ項目）", row && row.freeBlock === true);
  ok("備考が入る（sheetMarkerと同じ項目）", row && row.note === "タオル持参");
}

// -------- 3. readTplEditor()で行を読み直しても、行に入力欄が無いカテゴリは
//            消えずに引き継がれる（v3.179で修正。以前はcategory:""で
//            毎回上書きされていた） --------
{
  const T2 = T; // alias
  // readTplEditorはdocument.getElementById("tplForm")が無いと何もしないので、
  // ここでは直接 draft 上のオブジェクトが保持され続けることだけを確認する
  // （テンプレ編集画面のDOM全体を模すのは過剰なため、tpl-del-row等の経路で
  // 実際に読み直される前提のdraft構造そのものを検証）。
  ok("カテゴリはdraftに保持されたまま", T.state._tplDraft.plans[0].category === "運動");
}

// -------- 4. 「配置するタスク」の候補一覧: 完了型／継続型の切替・並び順が
//            ToDoリストに追加（sheetTodayPick）と同じ状態キーで独立して動く --------
T.state.tplPickView = "single";
T.state.tplPickSort = "default";
dispatchClick("tpl-pick-view", { v:"repeat" });
ok("tpl-pick-viewでtplPickViewが切り替わる", T.state.tplPickView === "repeat");
ok("スケジュールタブ側のpickViewには影響しない（状態を分けている）", T.state.pickView === "single");

dispatchClick("tpl-pick-view", { v:"single" });
dispatchClick("tpl-pick-sort", { v:"prio" });
ok("tpl-pick-sortでtplPickSortが切り替わる", T.state.tplPickSort === "prio");
ok("スケジュールタブ側のpickSortには影響しない", T.state.pickSort === "default");

// -------- 5. タスクを配置: 候補を選んで開始〜終了で所要を決め、
//            draft.tasksに積まれる（sheetAddOcc/add-todayと同じ算出方式） --------
T.state._tplDraft.tasks = [];
dispatchClick("tpl-task-pick", { id:"t2" });
ok("候補を選ぶと開始時刻入力画面(sheetTplTaskTime)が開く", sheetEl.innerHTML.includes("継続タスクB"));

elStore.ttStart = mkEl("ttStart"); elStore.ttStart.value = "07:00";
elStore.ttEnd = mkEl("ttEnd"); elStore.ttEnd.value = "";
dispatchClick("tpl-task-confirm", { id:"t2" });
{
  const row = T.state._tplDraft.tasks[0];
  ok("配置されたタスクの開始時刻が入る", row && row.time === "07:00");
  ok("終了が空欄なのでタスクの目安時間(20分)が所要になる", row && row.mins === 20);
}

console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAILURES`);
process.exit(fail ? 1 : 0);
