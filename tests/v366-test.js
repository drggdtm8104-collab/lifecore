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

// ---- setup: a single-kind task with a note, placed today, still planned ----
vm.runInContext(`
  db.tasks.push({ id:"t1", name:"提出書類", kind:"single", done:false, prio:"mid",
    due:null, duePrec:"day", startDate:null, startPrec:"day",
    category:"仕事", estMin:null, note:"タスク自体の固定メモ", createdAt:"2026-09-01" });
  db.occurrences.push({ id:"occ1", taskId:"t1", date:"2026-09-16", plannedStart:null, plannedMin:null,
    actualMin:null, status:"planned", doneAt:null, adhoc:false, title:null, note:"進捗:第1章まで", plan:false });
  state.date = "2026-09-16";
  state.todayView = "list";
`, sandbox);

// ============ 1. ToDoリストカード: レイアウト・トグルの検証 ============
vm.runInContext(`renderToday()`, sandbox);
let html = sandbox.document.getElementById("main").innerHTML;
check(!html.includes('data-act="complete"'), "1a: 完了ボタンが無い");
check(!html.includes('一部実施'), "1b: 一部実施の文言が一切無い");
check(!html.includes('取り消し'), "1c: 取り消しボタンが無い");
check(html.includes('data-act="toggle-occ-done" data-id="occ1"'), "1d: 状態バッジがtoggle-occ-doneボタンになっている");
check(!html.includes('<span class="cat">仕事</span>') && !html.includes('ti-meta grid4'), "1e: カテゴリ・重要度等の表示が無い（ToDoリストからは撤去）");
check(html.includes('data-act="edit-occ" data-id="occ1"'), "1f: 編集ボタンがcard-meta行にある");
check(!html.includes('タスク自体の固定メモ') && !html.includes('進捗:第1章まで'), "1g: メモはデフォルトで閉じている（内容が見えない）");
check(html.includes('data-act="toggle-note" data-id="occ1"'), "1h: メモトグルボタンがある（メモがあるので）");

// ---- メモを開く ----
vm.runInContext(`state._noteOpen = new Set(["occ1"]); renderToday();`, sandbox);
html = sandbox.document.getElementById("main").innerHTML;
check(html.includes('タスク自体の固定メモ') && html.includes('進捗:第1章まで'), "1i: メモを開くと両方（固定メモ＋進捗メモ）が同時に見える");

// ============ 2. 状態バッジのトグル動作 ============
vm.runInContext(`state._noteOpen = new Set();`, sandbox);
dispatchClick(mkBtn({ act:"toggle-occ-done", id:"occ1" }));
let occ1 = vm.runInContext(`db.occurrences.find(o=>o.id==="occ1")`, sandbox);
check(occ1.status === "done", "2a: トグルで未完了→完了に切り替わる");
let t1done = vm.runInContext(`db.tasks.find(x=>x.id==="t1").done`, sandbox);
check(t1done === true, "2b: 完了型タスク自体もdone=trueになる");

dispatchClick(mkBtn({ act:"toggle-occ-done", id:"occ1" }));
occ1 = vm.runInContext(`db.occurrences.find(o=>o.id==="occ1")`, sandbox);
check(occ1.status === "planned", "2c: もう一度押すと未完了に戻る（取り消し相当）");
check(occ1.actualMin === null && occ1.doneAt === null, "2d: 取り消し時にactualMin/doneAtがクリアされる");

// ============ 3. （廃止済み） ============
// v3.99で「完了ずみ」の折りたたみ一覧（toggle-done/state._showDone）自体が
// 廃止され、過去の完了結果は履歴タブに一本化された（app/index.htmlの
// v3.99コメント参照）。toggle-done というcaseもstate._showDoneというフィールド
// も現在のコードに存在せず、検証しようがないためこの項目は削除した。

console.log(ok ? "\nSECTION 1-2 ALL PASS" : "\nSECTION 1-2 SOME FAILED");
process.exit(ok?0:1);
