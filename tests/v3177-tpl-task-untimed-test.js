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

// v3.177: 「テンプレート編集でタスクを追加するとき、時間指定なしでも追加
// できるようにして」——以前は sheetTplTaskTime の「追加」ボタン
// (tpl-task-confirm) が開始時刻を必須にしていて、空欄だと
// 「開始時刻を入力してください」のトーストでブロックされていた。

T.db.tasks = [
  { id:"watertask", kind:"repeat", name:"水", rtype:"routine", freq:{type:"daily"} },
];
T.db.templates = [{ id:"tpl1", name:"テスト用テンプレ", plans:[], tasks:[] }];
T.db.occurrences = [];
T.db.dayMeta = {};
T.db.settings = {};

// -------- 1. 開始時刻を空欄のまま「追加」しても、ブロックされずに下書きに積まれる --------
T.state._tplDraft = { tplId:"tpl1", name:"テスト用テンプレ", plans:[], tasks:[] };
elStore.ttStart = mkEl("ttStart"); elStore.ttStart.value = "";
elStore.ttEnd = mkEl("ttEnd"); elStore.ttEnd.value = "";
dispatchClick("tpl-task-confirm", { id:"watertask" });

ok("開始時刻が空欄でも下書きにタスクが1件積まれる", T.state._tplDraft.tasks.length === 1);
ok("積まれた行は時間未定(time:null)になる", T.state._tplDraft.tasks[0] && T.state._tplDraft.tasks[0].time === null);
ok("追加後、シートは閉じる", sheetEl.innerHTML === "");

// -------- 2. 開始時刻を入れ、終了時刻からの算出でその時刻・所要が積まれる
//            （v3.179〜。sheetAddOcc/add-todayと同じ「終了から所要を算出」方式） --------
T.state._tplDraft.tasks = [];
elStore.ttStart.value = "08:30"; elStore.ttEnd.value = "08:45";
dispatchClick("tpl-task-confirm", { id:"watertask" });
ok("開始時刻を入れればその時刻で積まれる", T.state._tplDraft.tasks[0] && T.state._tplDraft.tasks[0].time === "08:30");
ok("終了時刻から所要(15分)が算出されて積まれる", T.state._tplDraft.tasks[0] && T.state._tplDraft.tasks[0].mins === 15);

// -------- 2b. 開始のみで終了が空欄なら、タスクの目安時間(estMin)が使われる --------
T.db.tasks[0].estMin = 10;
T.state._tplDraft.tasks = [];
elStore.ttStart.value = "09:00"; elStore.ttEnd.value = "";
dispatchClick("tpl-task-confirm", { id:"watertask" });
ok("終了が空欄ならタスクの目安時間が所要として積まれる", T.state._tplDraft.tasks[0] && T.state._tplDraft.tasks[0].mins === 10);
delete T.db.tasks[0].estMin;

// -------- 3. applyTemplate(): 時間未定(time:null)のタスク行から、
//            plannedStart:null の実施が作られる --------
T.db.templates[0].tasks = [{ taskId:"watertask", time:null, mins:null }];
T.applyTemplate(today, "tpl1");
const occ = T.db.occurrences.find(o=>o.date===today && o.taskId==="watertask");
ok("時間未定のテンプレ行から実施が作られる", !!occ);
ok("作られた実施のplannedStartはnull（時間未定のまま）", occ && occ.plannedStart === null);

// -------- 4. 再適用しても時間未定のまま保たれる（勝手に時刻が補われない） --------
T.applyTemplate(today, "tpl1");
const occ2 = T.db.occurrences.find(o=>o.date===today && o.taskId==="watertask");
ok("再適用後も実施は1件のまま（重複しない）", T.db.occurrences.filter(o=>o.date===today && o.taskId==="watertask").length === 1);
ok("再適用してもplannedStartはnullのまま", occ2 && occ2.plannedStart === null);

// -------- 5. テンプレ編集画面（編集タブ）: 「配置するタスク」の＋追加ボタンが
//            緑（primary）になっている --------
T.state.settingsTplId = "tpl1";
T.state.tplView = "edit";
T.state._tplDraft = null; // force rebuilding the draft from db.templates
T.db.templates[0].tasks = [];
T.renderTemplates();
{
  const html = elStore.main._html;
  ok("「配置するタスク」の＋追加ボタンがある", /data-act="tpl-task-add"/.test(html));
  ok("そのボタンにprimary（緑）クラスが付いている", /class="btn tiny primary"[^>]*data-act="tpl-task-add"/.test(html));
}

// -------- 6. 時間未定のまま配置ずみのタスク行は、編集画面の開始時刻欄が
//            空欄で表示される（"00:00"が補われていない） --------
T.db.templates[0].tasks = [{ taskId:"watertask", time:null, mins:null }];
T.state._tplDraft = null;
T.renderTemplates();
{
  const html = elStore.main._html;
  ok("配置ずみタスク行の開始時刻欄は空欄で表示される", /data-f="time" value=""/.test(html));
  ok("\"00:00\"が補われて表示されたりしない", !/data-f="time" value="00:00"/.test(html));
}

console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAILURES`);
process.exit(fail ? 1 : 0);
