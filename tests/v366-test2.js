const fs = require("fs");
const vm = require("vm");
const src = fs.readFileSync("C:\\Users\\hirom\\AppData\\Local\\Temp\\claude\\C--Users-hirom-Claude-LifeCore\\40dba0f7-d9f0-41be-aea7-13fea80b52f2\\scratchpad\\app.js", "utf8");

const elCache = new Map();
function mkEl(){
  const el = { dataset:{}, style:{}, value:"", classList:{add(){},remove(){},toggle(){},contains(){return false;}},
    addEventListener(){}, appendChild(){}, querySelector(){return mkEl();}, querySelectorAll(){return [];}, closest(){return null;}, focus(){}, scrollIntoView(){} };
  Object.defineProperty(el,"innerHTML",{get(){return this._h||"";},set(v){this._h=v;}});
  Object.defineProperty(el,"scrollTop",{get(){return 0;},set(v){}});
  return el;
}
const store = {};
const clickListeners = [];
const sandbox = {
  window:{addEventListener(){}},
  document:{
    addEventListener(name, fn){ if(name === "click") clickListeners.push(fn); },
    getElementById(id){ if(!elCache.has(id)) elCache.set(id, mkEl()); return elCache.get(id); },
    querySelector(){return mkEl();}, querySelectorAll(){return [];}, createElement(){return mkEl();}, body:mkEl(),
  },
  localStorage:{ getItem(k){return store[k]||null;}, setItem(k,v){store[k]=String(v);}, removeItem(k){delete store[k];} },
  navigator:{clipboard:{writeText:async()=>{}}},
  crypto:{randomUUID:()=>"aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"},
  console, setTimeout, clearTimeout, setInterval, clearInterval, Date,
};
sandbox.document.documentElement = mkEl();
sandbox.window.document = sandbox.document;
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: "app.js" });
vm.runInContext(`
  const __RealDate = Date;
  Date = class extends __RealDate {
    constructor(...args){ if(args.length===0) super("2026-09-16T10:00:00"); else super(...args); }
  };
`, sandbox);

function dispatchClick(actEl){
  const ev = { target: { closest: (sel) => (sel === "[data-act]" ? actEl : null) } };
  for(const fn of clickListeners) fn(ev);
}
function mkBtn(dataset){ const el = mkEl(); el.dataset = dataset; el.disabled = false; return el; }

let ok = true;
const check = (cond, msg) => { if(!cond){ ok=false; console.log("FAIL: "+msg); } else console.log("OK: "+msg); };

// ---- setup ----
vm.runInContext(`
  db.tasks.push({ id:"t1", name:"提出書類", kind:"single", done:false, prio:"mid",
    due:null, duePrec:"day", startDate:null, startPrec:"day",
    category:"仕事", estMin:null, note:"固定メモ", createdAt:"2026-09-01" });
  db.occurrences.push({ id:"occ1", taskId:"t1", date:"2026-09-16", plannedStart:null, plannedMin:null,
    actualMin:null, status:"planned", doneAt:null, adhoc:false, title:null, note:"進捗メモ内容", plan:false });
  state.date = "2026-09-16";
  state.tab = "tasks";
  state.tasksView = "single";
`, sandbox);

// ============ 4. タスクタブの行: メモタブが2行目に、行タップは編集を開く ============
vm.runInContext(`renderTasks()`, sandbox);
let html = sandbox.document.getElementById("main").innerHTML;
check(html.includes('class="task-item" data-act="edit-task" data-id="t1"'), "4a: 行全体がdiv+data-act=edit-taskになっている（buttonではない）");
check(html.includes('ti-meta-row'), "4b: メモタブ用のラッパー行がある");
check(html.includes('data-act="toggle-note" data-id="t1"'), "4c: メモトグルがt.id基準で存在する");
check(!html.includes('固定メモ') && !html.includes('進捗メモ内容'), "4d: メモはデフォルトで閉じている");

vm.runInContext(`state._noteOpen = new Set(["t1"]); renderTasks();`, sandbox);
html = sandbox.document.getElementById("main").innerHTML;
check(html.includes('固定メモ') && html.includes('進捗メモ内容'), "4e: メモを開くと固定メモ＋進捗メモが両方見える（今日の実施と連動）");

// タップして開くと edit-task が呼ばれることの確認（sheetTaskが呼ばれてシートにタイトルが入る）
vm.runInContext(`state._noteOpen = new Set();`, sandbox);
dispatchClick(mkBtn({ act:"edit-task", id:"t1" }));
let sheetHtml = sandbox.document.getElementById("sheet").innerHTML;
check(sheetHtml.includes("タスクを編集"), "4f: 行をタップするとタスク編集シートが開く");
check(sheetHtml.includes('id="tkProgress"'), "4g: 編集シートに進捗メモ欄が出る（今日の実施があるため）");
check(sheetHtml.includes('進捗メモ内容'), "4h: 進捗メモ欄に今日の実施のnoteが入っている");

// ============ 5. sheetTaskから進捗メモを編集して保存 -> occurrenceに反映される ============
sandbox.document.getElementById("tkName").value = "提出書類";
sandbox.document.getElementById("tkNote").value = "固定メモ（変更後）";
// このテストのDOMモックはHTML文字列を実際にパースしないため、data-occid属性を
// 手動で反映する（実ブラウザではrenderが再構築した要素にこの属性が付いている）
sandbox.document.getElementById("tkProgress").dataset.occid = "occ1";
sandbox.document.getElementById("tkProgress").value = "進捗メモ（変更後）";
dispatchClick(mkBtn({ act:"save-task", id:"t1" }));
const t1 = vm.runInContext(`db.tasks.find(x=>x.id==="t1")`, sandbox);
const occAfter = vm.runInContext(`db.occurrences.find(o=>o.id==="occ1")`, sandbox);
check(t1.note === "固定メモ（変更後）", "5a: タスク自体のメモが保存される");
check(occAfter.note === "進捗メモ（変更後）", "5b: 進捗メモがoccurrenceのnoteに書き戻される（ToDoリストと連動）");

// ============ 6. 今日の実施が無いタスクは進捗メモ欄を出さない ============
vm.runInContext(`
  db.tasks.push({ id:"t2", name:"未着手タスク", kind:"single", done:false, prio:"low",
    due:null, duePrec:"day", startDate:null, startPrec:"day",
    category:"その他", estMin:null, note:"", createdAt:"2026-09-01" });
`, sandbox);
dispatchClick(mkBtn({ act:"edit-task", id:"t2" }));
const sheetHtml2 = sandbox.document.getElementById("sheet").innerHTML;
check(!sheetHtml2.includes('id="tkProgress"'), "6: 今日の実施が無いタスクには進捗メモ欄が出ない");

console.log(ok ? "\nSECTION 4-6 ALL PASS" : "\nSECTION 4-6 SOME FAILED");
process.exit(ok?0:1);
