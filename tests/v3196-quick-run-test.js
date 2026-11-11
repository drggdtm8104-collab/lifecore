const fs = require("fs");
const vm = require("vm");
const path = require("path");

const src = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");

let fail = 0;
function ok(name, cond){
  if(cond){ console.log("PASS", name); } else { console.log("FAIL", name); fail++; }
}

function mkEl(id){
  const el = {
    id, _html: "", value: "",
    classList: { add(){}, remove(){}, toggle(){}, contains(){return false;} },
    style: {}, dataset: {}, children: [],
    addEventListener(){}, querySelector(){ return mkEl(); }, querySelectorAll(){ return []; },
    closest(){ return null; }, appendChild(){}, remove(){}, focus(){},
    get innerHTML(){ return this._html; }, set innerHTML(v){ this._html = v; },
    getAttribute(){ return null; }, setAttribute(){},
  };
  return el;
}

const documentListeners = {};
const elStore = { main: mkEl("main"), fab: mkEl(), fabMenu: mkEl() };
const fakeDocument = {
  addEventListener(ev, fn){ (documentListeners[ev] = documentListeners[ev]||[]).push(fn); },
  getElementById(id){ if(!elStore[id]) elStore[id] = mkEl(id); return elStore[id]; },
  querySelector(){ return mkEl(); }, querySelectorAll(){ return []; },
  createElement(){ return mkEl(); }, body: mkEl(), documentElement: mkEl(),
};

let fetchCalls = [];
const sandbox = {
  document: fakeDocument, window: {}, console,
  localStorage: (function(){
    let store = {};
    return { getItem(k){ return store[k]===undefined?null:store[k]; }, setItem(k,v){ store[k]=String(v); }, removeItem(k){ delete store[k]; } };
  })(),
  navigator: { onLine: true, serviceWorker: undefined },
  fetch: async (url, opts) => { fetchCalls.push({ url, opts }); return { ok:false }; },
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
vm.runInContext(`globalThis.__t = { get db(){ return db; }, set db(v){ db=v; }, get state(){ return state; }, renderTasks, todayStr };`, sandbox);
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

// v3.196: 「継続型タスクを一日に何度も実行したり予定外に実施することもある」
// との指示で追加した「実行」ボタン。ToDoリストに追加→状態バッジで完了、の
// 2段階を踏まずに、タスクタブの継続型一覧から直接、完了ずみのoccurrenceを
// その場で1件作る。時刻・進捗メモは任意。

T.db.tasks = [
  { id:"t1", name:"水を飲む", kind:"repeat", freq:{type:"daily"}, estMin:5, category:"健康", note:"", due:null, duePrec:"day", prio:"low", startDate:null, startPrec:"day", rtype:"routine", done:false, createdAt:today },
  { id:"t2", name:"資格勉強", kind:"single", freq:null, estMin:30, category:"学習", note:"", due:null, duePrec:"day", prio:"low", startDate:null, startPrec:"day", rtype:null, done:false, createdAt:today },
];
T.db.occurrences = [];
T.state.date = today;

// --- 1. 「直接実行」ボタンは継続型タスク一覧にだけ出る（完了型には出ない） ---
T.state.tasksView = "repeat";
T.renderTasks();
{
  const html = sandbox.document.getElementById("main").innerHTML;
  ok("継続型タスク一覧には「直接実行」ボタンが出る",
    html.includes('data-act="quick-run" data-id="t1">直接実行</button>'));
  // v3.196: 「右下に、追加済みのリボンと被らないように」との指示。新しい行を
  // 追加すると余計な隙間ができてしまったため、種類/頻度/カテゴリの行
  // （ti-meta-row、カードの一番下に来る行）自体を両端揃えにして、その右側に
  // 同じ行の一部として収める形にした（新しい行は増やさない）。
  const idxMetaRow = html.indexOf('class="ti-meta-row"');
  const idxQuickRun = html.indexOf('data-act="quick-run"');
  ok("「直接実行」はti-meta-row（種類/頻度/カテゴリの行）の中、右側にある",
    idxMetaRow !== -1 && idxQuickRun > idxMetaRow);
  ok("ti-meta-rowは両端揃え（justify-content:space-between）で右側に寄せている",
    /class="ti-meta-row" style="justify-content:space-between"/.test(html));
  // v3.196追記: 「ボタンに枠を付けて。種類や頻度の枠を参照」との指示で、
  // 枠（border）を追加。高さを種類(.ti-rtype: border:1px solid var(--hairline);
  // padding:1px 6px;font-size:10px)と完全に同じ値にすることで、枠を足しても
  // 高さがずれないようにしている（<button>が.btnクラスから引き継ぐ
  // line-height:1も、マーク側の継承の1.5に明示的に揃えている）。
  ok("「直接実行」ボタンに種類(.ti-rtype)と同じ枠・高さが付いている",
    /style="flex:none;border:1px solid var\(--hairline\);line-height:1\.5;padding:1px 6px;font-size:10px;border-radius:6px"\s*data-act="quick-run"/.test(html));
}

// --- 1b. 「メモの位置がおかしくなっている。もとは左寄りだった」との指摘で修正。
//          「メモ ▾/▲」は種類/頻度と同じ左側のグループのままで、「直接実行」
//          だけが右側（justify-content:space-betweenのもう一方）に来る。 ---
T.db.tasks.push({ id:"t3", name:"メモ付きタスク", kind:"repeat", freq:{type:"daily"}, estMin:5, category:"健康", note:"固定メモ", due:null, duePrec:"day", prio:"low", startDate:null, startPrec:"day", rtype:"routine", done:false, createdAt:today });
T.renderTasks();
{
  const html = sandbox.document.getElementById("main").innerHTML;
  // t3（メモ付きタスク）の行だけを切り出して順序を見る（t1はメモが無いので
  // 「メモ」トグル自体が存在せず、同じhtml全体をそのまま見るとt1側の
  // 「直接実行」が先に出てきてしまい、t3の行の中の並びを正しく見られない）。
  const rowStart = html.indexOf("メモ付きタスク");
  const row = html.slice(rowStart);
  const idxWrapGroup = row.indexOf('style="display:flex;align-items:center;gap:6px"');
  const idxTiMeta = row.indexOf('class="ti-meta"');
  const idxNoteToggle = row.indexOf('class="note-toggle"');
  const idxQuickRun = row.indexOf('data-act="quick-run"');
  ok("「メモ」トグルは種類/頻度と同じ左側のグループに入っている（種類→メモ→直接実行の順）",
    rowStart !== -1 && idxWrapGroup !== -1 && idxWrapGroup < idxTiMeta && idxTiMeta < idxNoteToggle && idxNoteToggle < idxQuickRun);
}

T.state.tasksView = "single";
T.renderTasks();
{
  const html = sandbox.document.getElementById("main").innerHTML;
  ok("完了型タスク一覧には「直接実行」ボタンは出ない", !html.includes('data-act="quick-run"'));
}

// --- 2. 「直接実行」を押すとシートが開き、開始/終了/進捗メモ/完了する/キャンセルが並ぶ ---
dispatchClick("quick-run", { id:"t1" });
{
  const sheetHtml = sandbox.document.getElementById("sheet").innerHTML;
  ok("シートに開始の時刻欄(qrStart)がある", sheetHtml.includes('id="qrStart"'));
  ok("シートに終了の時刻欄(qrEnd)がある", sheetHtml.includes('id="qrEnd"'));
  ok("シートに進捗メモ欄(qrNote)がある", sheetHtml.includes('id="qrNote"'));
  ok("シートに「完了する」ボタンがある", /data-act="quick-run-confirm" data-id="t1">完了する/.test(sheetHtml));
  ok("シートに「キャンセル」ボタンがある", sheetHtml.includes('data-act="close-sheet">キャンセル'));
}

// --- 3. 時刻・メモを入れて「完了する」→ 完了ずみのoccurrenceが1件作られる ---
sandbox.document.getElementById("qrStart").value = "09:00";
sandbox.document.getElementById("qrEnd").value = "09:10";
sandbox.document.getElementById("qrNote").value = "1セットだけ";
dispatchClick("quick-run-confirm", { id:"t1" });
{
  const occs = T.db.occurrences.filter(o=>o.taskId==="t1");
  ok("occurrenceが1件作られる", occs.length === 1);
  const o = occs[0];
  ok("日付は今日", o.date === today);
  ok("statusは done", o.status === "done");
  ok("adhoc は true（予定外の実行として記録される）", o.adhoc === true);
  ok("plannedStart は入力した開始時刻", o.plannedStart === "09:00");
  ok("plannedMin は開始〜終了から計算される(10分)", o.plannedMin === 10);
  ok("actualMin は所要時間(10分)になる", o.actualMin === 10);
  ok("進捗メモが保存される", o.note === "1セットだけ");
  ok("doneAt が設定される", !!o.doneAt);
  const call = fetchCalls.find(c => c.url.endsWith("/task-event"));
  ok("MyQuestへのtask.completedイベントも送られる", !!call && JSON.parse(call.opts.body).type === "task.completed");
}

// --- 4. 時刻・メモを空欄のまま「完了する」→ actualMinはestMinで補われる ---
fetchCalls = [];
sandbox.document.getElementById("qrStart").value = "";
sandbox.document.getElementById("qrEnd").value = "";
sandbox.document.getElementById("qrNote").value = "";
dispatchClick("quick-run-confirm", { id:"t1" });
{
  const occs = T.db.occurrences.filter(o=>o.taskId==="t1");
  ok("2回目の実行で2件目のoccurrenceが作られる（1日に複数回実行できる）", occs.length === 2);
  const o = occs[1];
  ok("plannedStart は空欄なら null", o.plannedStart === null);
  ok("actualMin はestMin(5分)で補われる", o.actualMin === 5);
}

console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAILURES`);
process.exit(fail ? 1 : 0);
