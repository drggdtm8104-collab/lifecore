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

// 「#tkFreq button.on」のように、特定のラジオ行の選択中ボタンを読む箇所を
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
  sheetTask, migrate, freqChip, rtypeChip, renderTasks, sheetTodayPick, todayStr };`, sandbox);
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

// v3.201: 「継続型タスクの頻度仕様を変える。毎日と不定期の選択肢にして、
// 現状見て判断するために使う」との指示。それまでの「毎日/週n回（回数目標を
// 管理）」をやめ、「毎日/不定期（目標なし、本人が見て判断）」の2択にした。
// あわせて「ルーティンとスキルで幅が違うのと、頻度は不定期を使うのでそっちに
// 幅を合わせて、全てのタスクで横幅が揃うようにして」との指示で、
// .ti-rtype/.ti-freqを固定幅チップにした（CSSの幅自体はNodeのテストでは
// 検証できないため、ここではクラス・ラベルなどマークアップ面のみ検証する）。

const sheetEl = elStore.sheet || (elStore.sheet = mkEl("sheet"));

// -------- 1. 登録シート: 頻度は「毎日」「不定期」の2択のみ。
//            旧「週」ボタン・回数ステッパー・「回 / 週」ラベルは出ない --------
radioSelections.tkKind = "repeat";
T.sheetTask(null);
{
  const html = sheetEl.innerHTML;
  ok("頻度に「毎日」ボタンがある", /data-v="daily"[^>]*>毎日</.test(html));
  ok("頻度に「不定期」ボタンがある", /data-v="irregular"[^>]*>不定期</.test(html));
  ok("旧「週」ボタンは出ない", !html.includes(">週<"));
  ok("回数ステッパー(tkN/tkNv)は出ない", !html.includes('id="tkN"') && !html.includes('id="tkNv"'));
  ok("「回 / 週」ラベルは出ない", !html.includes("回 / 週"));
}

// -------- 2. 新規タスク（継続型・毎日既定）を保存すると freq:{type:"daily"} になる --------
T.db.tasks = [];
T.db.occurrences = [];
elStore.tkName = mkEl("tkName"); elStore.tkName.value = "新しい継続タスク";
dispatchClick("save-task");
ok("既定（毎日）で保存される", T.db.tasks.length === 1 && T.db.tasks[0].freq.type === "daily");
ok("freqにnは付かない（daily）", T.db.tasks[0].freq.n === undefined);

// -------- 3. 「不定期」を選んで保存すると freq:{type:"irregular"} になる（nは付かない） --------
T.db.tasks = [];
radioSelections.tkFreq = "irregular";
dispatchClick("save-task");
ok("「不定期」を選ぶとfreq.typeがirregularになる", T.db.tasks.length === 1 && T.db.tasks[0].freq.type === "irregular");
ok("freqにnは付かない（irregular）", T.db.tasks[0].freq.n === undefined);
delete radioSelections.tkFreq;
delete radioSelections.tkKind;

// -------- 4. 既存データの移行: 旧 freq:{type:"perWeek",n:3} は type:"irregular" に
//            読み替えられ、nは捨てられる --------
{
  const legacy = {
    tasks: [
      { id:"old1", name:"旧・週3回タスク", kind:"repeat", freq:{type:"perWeek", n:3}, category:"運動", note:"", due:null, prio:"low", startDate:null, rtype:"skill", createdAt:"2026-01-01", done:false },
      { id:"old2", name:"旧・毎日タスク", kind:"repeat", freq:{type:"daily"}, category:"その他", note:"", due:null, prio:"low", startDate:null, rtype:"routine", createdAt:"2026-01-01", done:false },
    ],
    occurrences: [], templates: [], notes: [], remarks: [],
  };
  const migrated = T.migrate(legacy);
  const a = migrated.tasks.find(t=>t.id==="old1");
  const b = migrated.tasks.find(t=>t.id==="old2");
  ok("旧perWeekタスクはirregularに読み替えられる", a && a.freq.type === "irregular");
  ok("旧perWeekのnは捨てられる", a && a.freq.n === undefined);
  ok("旧dailyタスクはそのままdaily", b && b.freq.type === "daily");
}

// -------- 5. freqChip()/rtypeChip(): ラベルと固定幅用のクラスが付く --------
ok("freqChip: 毎日タスクは「毎日」、クラスはdaily", T.freqChip({freq:{type:"daily"}}) === '<span class="ti-freq daily">毎日</span>');
ok("freqChip: 不定期タスクは「不定期」、クラスはirregular", T.freqChip({freq:{type:"irregular"}}) === '<span class="ti-freq irregular">不定期</span>');
ok("freqChip: freq未設定でも毎日扱い（既定）", T.freqChip({freq:null}) === '<span class="ti-freq daily">毎日</span>');
ok("rtypeChip: ルーティン", T.rtypeChip({rtype:"routine"}) === '<span class="ti-rtype routine">ルーティン</span>');
ok("rtypeChip: スキル", T.rtypeChip({rtype:"skill"}) === '<span class="ti-rtype skill">スキル</span>');

// -------- 6. タスク一覧（タスクタブ）でも、毎日/不定期それぞれ正しく表示される --------
T.db.tasks = [
  { id:"t1", name:"毎日タスク", kind:"repeat", freq:{type:"daily"}, estMin:5, category:"健康", note:"", due:null, duePrec:"day", prio:"low", startDate:null, startPrec:"day", rtype:"routine", done:false, createdAt:today },
  { id:"t2", name:"不定期タスク", kind:"repeat", freq:{type:"irregular"}, estMin:20, category:"運動", note:"", due:null, duePrec:"day", prio:"low", startDate:null, startPrec:"day", rtype:"skill", done:false, createdAt:today },
];
T.db.occurrences = [];
T.state.tasksView = "repeat";
T.renderTasks();
{
  const html = elStore.main.innerHTML;
  ok("タスク一覧: 毎日タスクに「毎日」バッジが出る", html.includes('<span class="ti-freq daily">毎日</span>'));
  ok("タスク一覧: 不定期タスクに「不定期」バッジが出る", html.includes('<span class="ti-freq irregular">不定期</span>'));
  ok("タスク一覧にはもう「今週」の実施回数表示は出ない", !html.includes("今週"));
}

// -------- 7. 「今日のToDoに追加」の候補一覧（sheetTodayPick）でも同じチップが出る --------
T.state.date = today;
T.state.pickView = "repeat";
T.sheetTodayPick();
{
  const html = sheetEl.innerHTML;
  ok("候補一覧: 毎日タスクに「毎日」バッジが出る", html.includes('<span class="ti-freq daily">毎日</span>'));
  ok("候補一覧: 不定期タスクに「不定期」バッジが出る", html.includes('<span class="ti-freq irregular">不定期</span>'));
}

console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAILURES`);
process.exit(fail ? 1 : 0);
