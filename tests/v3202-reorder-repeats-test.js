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
const elStore = { main: mkEl("main"), fab: mkEl(), fabMenu: mkEl() };

// 「#tkKind button.on」のように、特定のラジオ行の選択中ボタンを読む箇所を
// 検証したいので、querySelectorだけそのセレクタに応じたdata-vを返す
// 簡易実装にする（v3181-task-weight-test.jsと同じパターン）。
const radioSelections = {};
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
    return { getItem(k){ return store[k]===undefined?null:store[k]; }, setItem(k,v){ store[k]=String(v); }, removeItem(k){ delete store[k]; } };
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
  crypto: require("crypto").webcrypto || { randomUUID(){ return require("crypto").randomUUID(); }, getRandomValues(arr){ return require("crypto").randomFillSync(arr); } },
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
vm.runInContext(`globalThis.__t = { get db(){ return db; }, set db(v){ db=v; }, get state(){ return state; },
  migrate, byOrder, moveRepeatTask, sheetReorderRepeats, sheetTask, renderTasks, todayStr };`, sandbox);
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

// v3.202: 「継続タスクを任意に並べ替えられるようにしたい」との指示。
// 「画面をあまり複雑にしたくないが、上下移動と最上下に移動の両方があると
// もう少し楽そう」との方針で、専用の「並べ替え」シートに▲▲/▲/▼/▼▼の
// 4ボタンを用意し、rtypeグループ（ルーティン／スキル）ごとに独立して
// 並べ替えられるようにした。並び順はt.order（グループ内0始まりの連番）で
// 管理し、タスク一覧・候補一覧の表示はbyCreated固定からbyOrderに変わった。

const sheetEl = elStore.sheet || (elStore.sheet = mkEl("sheet"));

// -------- 1. migrate(): orderを持たない旧データには、createdAt昇順を
//            そのままorderとして焼き込む（rtypeグループごと） --------
{
  const legacy = {
    tasks: [
      { id:"r1", name:"古いルーティンA", kind:"repeat", freq:{type:"daily"}, category:"", note:"", due:null, prio:"low", startDate:null, duePrec:"day", startPrec:"day", rtype:"routine", createdAt:"2026-01-01", done:false },
      { id:"r2", name:"古いルーティンB", kind:"repeat", freq:{type:"daily"}, category:"", note:"", due:null, prio:"low", startDate:null, duePrec:"day", startPrec:"day", rtype:"routine", createdAt:"2026-02-01", done:false },
      { id:"r3", name:"古いスキルA", kind:"repeat", freq:{type:"irregular"}, category:"", note:"", due:null, prio:"low", startDate:null, duePrec:"day", startPrec:"day", rtype:"skill", createdAt:"2026-03-01", done:false },
    ],
    occurrences: [], templates: [], notes: [], remarks: [],
  };
  const migrated = T.migrate(legacy);
  const r1 = migrated.tasks.find(t=>t.id==="r1"), r2 = migrated.tasks.find(t=>t.id==="r2"), r3 = migrated.tasks.find(t=>t.id==="r3");
  ok("旧データ: ルーティングループ内でcreatedAt昇順のorderが付く(r1<r2)", r1.order < r2.order);
  ok("旧データ: スキルグループは別の連番(0始まり)", r3.order === 0);
}

// -------- 2. moveRepeatTask(): up/down/top/bottomでグループ内の並びが
//            入れ替わり、orderが0..n-1に振り直される --------
T.db.tasks = [
  { id:"a", name:"A", kind:"repeat", freq:{type:"daily"}, rtype:"routine", order:0, category:"", note:"", createdAt:today, done:false },
  { id:"b", name:"B", kind:"repeat", freq:{type:"daily"}, rtype:"routine", order:1, category:"", note:"", createdAt:today, done:false },
  { id:"c", name:"C", kind:"repeat", freq:{type:"daily"}, rtype:"routine", order:2, category:"", note:"", createdAt:today, done:false },
];
T.db.occurrences = [];
const groupOrder = () => T.db.tasks.filter(t=>t.rtype==="routine").sort(T.byOrder).map(t=>t.id);

ok("初期状態: A,B,C の順", groupOrder().join(",") === "a,b,c");

T.moveRepeatTask("b", "up");
ok("Bを上へ: B,A,C の順になる", groupOrder().join(",") === "b,a,c");

T.moveRepeatTask("b", "down");
ok("Bを下へ戻す: A,B,C の順に戻る", groupOrder().join(",") === "a,b,c");

T.moveRepeatTask("c", "top");
ok("Cを最上へ: C,A,B の順になる", groupOrder().join(",") === "c,a,b");

T.moveRepeatTask("c", "bottom");
ok("Cを最下へ戻す: A,B,C の順に戻る", groupOrder().join(",") === "a,b,c");

{
  const orders = T.db.tasks.filter(t=>t.rtype==="routine").sort(T.byOrder).map(t=>t.order);
  ok("並べ替え後もorderは0,1,2の連番に振り直される", JSON.stringify(orders) === JSON.stringify([0,1,2]));
}

// 先頭を「上へ」/「最上へ」、末尾を「下へ」/「最下へ」しても何も起きない（安全）
T.moveRepeatTask("a", "up");
ok("既に先頭のタスクを「上へ」しても順序は変わらない", groupOrder().join(",") === "a,b,c");
T.moveRepeatTask("c", "down");
ok("既に末尾のタスクを「下へ」しても順序は変わらない", groupOrder().join(",") === "a,b,c");

// -------- 3. sheetReorderRepeats(): 各グループの先頭/末尾で▲▲▲/▼▼が
//            disabledになる --------
T.sheetReorderRepeats();
{
  const html = sheetEl.innerHTML;
  ok("並べ替えシートの見出しが出る", html.includes("<h2>継続型タスクの並べ替え</h2>"));
  ok("先頭(A)の「最上へ」「上へ」はdisabled", new RegExp(`data-act="reorder-top" data-id="a" disabled`).test(html) && new RegExp(`data-act="reorder-up" data-id="a" disabled`).test(html));
  ok("先頭(A)の「下へ」「最下へ」はdisabledではない", !new RegExp(`data-act="reorder-down" data-id="a" disabled`).test(html) && !new RegExp(`data-act="reorder-bottom" data-id="a" disabled`).test(html));
  ok("末尾(C)の「下へ」「最下へ」はdisabled", new RegExp(`data-act="reorder-down" data-id="c" disabled`).test(html) && new RegExp(`data-act="reorder-bottom" data-id="c" disabled`).test(html));
  ok("中間(B)はどのボタンもdisabledではない", !new RegExp(`data-id="b" disabled`).test(html) && !html.match(/data-id="b"[^>]*disabled/));
}

// -------- 4. 「並べ替え」ボタン(reorder-top等)のdispatchでも実際に並びが
//            変わり、タスク一覧(renderTasks)の表示順にも反映される -------
dispatchClick("reorder-top", { id:"c" });
ok("dispatch経由でも並びが変わる(C,A,B)", groupOrder().join(",") === "c,a,b");

T.state.tasksView = "repeat";
T.renderTasks();
{
  const html = elStore.main.innerHTML;
  const idxA = html.indexOf('data-id="a"');
  const idxB = html.indexOf('data-id="b"');
  const idxC = html.indexOf('data-id="c"');
  ok("タスク一覧の表示順も並べ替え後の順（C→A→B）になる", idxC !== -1 && idxC < idxA && idxA < idxB);
}

// -------- 5. 新規の継続型タスクを保存すると、そのグループの末尾
//            （既存の最大order+1）に追加される --------
T.db.tasks = [
  { id:"x", name:"既存X", kind:"repeat", freq:{type:"daily"}, rtype:"routine", order:0, category:"その他", note:"", createdAt:today, done:false, weight:10 },
  { id:"y", name:"既存Y", kind:"repeat", freq:{type:"daily"}, rtype:"routine", order:1, category:"その他", note:"", createdAt:today, done:false, weight:10 },
];
radioSelections.tkKind = "repeat";
elStore.tkName = mkEl("tkName"); elStore.tkName.value = "新規ルーティン";
dispatchClick("save-task");
{
  const z = T.db.tasks.find(t=>t.name==="新規ルーティン");
  ok("新規タスクのorderは既存グループの末尾(2)になる", !!z && z.order === 2);
}
delete radioSelections.tkKind;

console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAILURES`);
process.exit(fail ? 1 : 0);
