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
    appendChild(){}, focus(){}, remove(){},
    get innerHTML(){ return this._html; },
    set innerHTML(v){ this._html = v; },
    getAttribute(){ return null; }, setAttribute(){},
    __listeners: listeners,
  };
  return el;
}

const documentListeners = {};
const elStore = { main: mkEl(), fab: mkEl(), fabMenu: mkEl() };

// このテストでは「#tkWeight button.on」「#tkPrio button.on」のように、特定の
// ラジオ行の選択中ボタンを読む箇所を検証したいので、querySelectorだけ
// そのセレクタに応じたdata-vを返す簡易実装にする（他はmkEl()のまま）。
const radioSelections = {};   // 例: { tkWeight: "10", tkKind: "single" }
const fakeDocument = {
  addEventListener(ev, fn){ (documentListeners[ev] = documentListeners[ev]||[]).push(fn); },
  getElementById(id){ if(!elStore[id]) elStore[id] = mkEl(id); return elStore[id]; },
  querySelector(sel){
    const m = sel.match(/^#(\w+)\s+button\.on$/);
    if(m && radioSelections[m[1]] !== undefined){
      const btn = mkEl();
      btn.dataset = { v: radioSelections[m[1]] };
      return btn;
    }
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
vm.runInContext(`globalThis.__t = { get db(){ return db; }, set db(v){ db=v; }, get state(){ return state; }, sheetTask, migrate };`, sandbox);
const T = sandbox.__t;

const sheetEl = elStore.sheet || (elStore.sheet = mkEl("sheet"));

function dispatchClick(dataAct, extra){
  const t = mkEl();
  t.dataset = Object.assign({ act: dataAct }, extra||{});
  t.closest = function(sel){ if(sel === "[data-act]") return t; return null; };
  const handlers = documentListeners["click"] || [];
  const evt = { target: t, preventDefault(){}, stopPropagation(){} };
  handlers.forEach(fn=>fn(evt));
}

// v3.181: 「完了型タスクには重み（5/10/15の3択、既定5）、継続型タスクには
// 具体的なポイント（自由入力の整数、既定10・上下限なし）」をタスクごとに
// 登録できるようにし、MyQuest連携（/task-event）にも載せる。あわせて、
// 登録シートで「毎回判断してほしい項目」（タイトル・タスクの型・重要度・
// 種類）だけを背景色のパネルで目立たせる。

T.db.tasks = [];
T.db.occurrences = [];

// -------- 1. 新規タスク（完了型）: 重みの3択ボタン(5/10/15)が出る。既定は5 --------
delete radioSelections.tkKind;
T.sheetTask(null);
{
  const html = sheetEl.innerHTML;
  ok("完了型の重み3択(5/10/15)が全部出る", ['5','10','15'].every(v => html.includes(`data-v="${v}"`)));
  ok("新規タスクでは重み5が既定で選択されている", /data-v="5"[^>]*class="on"/.test(html));
  ok("重み10は未選択", /data-v="10"[^>]*class=""/.test(html));
  ok("重み15は未選択", /data-v="15"[^>]*class=""/.test(html));
}

// -------- 2. 新規タスク（完了型）を保存すると、重み既定の5が登録される --------
elStore.tkName = mkEl("tkName"); elStore.tkName.value = "新しいタスク";
radioSelections.tkKind = "single";
dispatchClick("save-task");
ok("既定(5)でタスクのweightが保存される", T.db.tasks.length === 1 && T.db.tasks[0].weight === 5);

// -------- 3. 重み15を選んで保存すると、そのタスクのweightが15になる --------
T.db.tasks = [];
T.sheetTask(null);
radioSelections.tkWeight = "15";
dispatchClick("save-task");
ok("選んだ重み(15)がタスクのweightとして保存される", T.db.tasks.length === 1 && T.db.tasks[0].weight === 15);
delete radioSelections.tkWeight;

// -------- 4. 継続型タスク: ポイントの自由入力欄が出る。既定値は10 --------
T.db.tasks = [];
radioSelections.tkKind = "repeat";
T.sheetTask(null);
{
  const html = sheetEl.innerHTML;
  ok("継続型のポイント入力欄が出る(id=tkPoints)", /id="tkPoints"[^>]*value="10"/.test(html));
}
elStore.tkPoints = mkEl("tkPoints"); elStore.tkPoints.value = "37";
dispatchClick("save-task");
ok("継続型で入力した具体的な整数がweightとして保存される", T.db.tasks.length === 1 && T.db.tasks[0].weight === 37);

// -------- 5. 継続型でポイント欄を空欄にすると、既定の10が使われる --------
T.db.tasks = [];
T.sheetTask(null);
elStore.tkPoints.value = "";
dispatchClick("save-task");
ok("継続型でポイント欄が空欄なら既定の10が保存される", T.db.tasks.length === 1 && T.db.tasks[0].weight === 10);
delete radioSelections.tkKind;

// -------- 6. 既存データの移行: weightを持たない旧タスクには既定値が補われる
//            （完了型は5、継続型は10） --------
{
  const legacy = {
    tasks: [
      { id:"old1", name:"旧タスクA", kind:"single", category:"その他", note:"", due:null, prio:"low", startDate:null, duePrec:"day", startPrec:"day", createdAt:"2026-01-01", done:false },
      { id:"old2", name:"旧タスクB", kind:"repeat", freq:{type:"daily"}, category:"その他", note:"", due:null, prio:"low", startDate:null, rtype:"routine", createdAt:"2026-01-01", done:false },
    ],
    occurrences: [], templates: [], notes: [], remarks: [],
  };
  const migrated = T.migrate(legacy);
  const a = migrated.tasks.find(t=>t.id==="old1");
  const b = migrated.tasks.find(t=>t.id==="old2");
  ok("旧・完了型タスクの既定weightは5", a && a.weight === 5);
  ok("旧・継続型タスクの既定weightは10", b && b.weight === 10);
}

// -------- 7. 登録シート: 目立たせる対象（タイトル・タスクの型・重要度・種類）
//            だけが.fld-highlightで囲まれている --------
radioSelections.tkKind = "single";
T.sheetTask(null);
{
  const html = sheetEl.innerHTML;
  ok("タイトルがfld-highlightの中にある", /fld-highlight[\s\S]{0,80}タイトル/.test(html));
  ok("タスクの型がfld-highlightの中にある", /fld-highlight[\s\S]{0,80}タスクの型/.test(html));
  ok("重要度がfld-highlightの中にある", /fld-highlight[\s\S]{0,80}重要度/.test(html));
  ok("カテゴリはfld-highlightの外（装飾なし）", !/fld-highlight[\s\S]{0,40}カテゴリ/.test(html));
}
radioSelections.tkKind = "repeat";
T.sheetTask(null);
{
  const html = sheetEl.innerHTML;
  ok("種類（継続型）がfld-highlightの中にある", /fld-highlight[\s\S]{0,80}種類/.test(html));
  ok("頻度はfld-highlightの外（装飾なし、対象に含まれていない）", !/fld-highlight[\s\S]{0,40}頻度/.test(html));
}

console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAILURES`);
process.exit(fail ? 1 : 0);
