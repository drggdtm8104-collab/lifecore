const fs = require("fs");
const vm = require("vm");
const src = fs.readFileSync("C:\\Users\\hirom\\AppData\\Local\\Temp\\claude\\C--Users-hirom-Claude-LifeCore\\40dba0f7-d9f0-41be-aea7-13fea80b52f2\\scratchpad\\app.js", "utf8");

function mkEl(){
  const el = { dataset:{}, style:{}, value:"", classList:{add(){},remove(){},toggle(){},contains(){return false;}},
    addEventListener(){}, appendChild(){}, querySelector(){return mkEl();}, querySelectorAll(){return [];}, closest(){return null;}, focus(){}, scrollIntoView(){} };
  Object.defineProperty(el,"innerHTML",{get(){return this._h||"";},set(v){this._h=v;}});
  Object.defineProperty(el,"scrollTop",{get(){return 0;},set(v){}});
  return el;
}
const elCache = new Map();
const store = {};
// pre-seed localStorage with a legacy db that has a "partial" occurrence, BEFORE app.js loads
// (so loadLocal()/migrate() runs on it during initial `let db = loadLocal();`)
const legacyDb = {
  version: 1,
  meta: { sample: false },
  settings: { showOutlook: true },
  templates: [],
  notes: [],
  tasks: [{ id:"t1", name:"資格勉強", kind:"single", done:false, prio:"mid", due:null, duePrec:"day",
    startDate:null, startPrec:"day", category:"勉強", estMin:null, note:"", createdAt:"2026-09-01" }],
  occurrences: [{ id:"legacyOcc", taskId:"t1", date:"2026-09-14", plannedStart:"21:00", plannedMin:30,
    actualMin:15, status:"partial", doneAt:"2026-09-14T21:30:00", adhoc:false, title:null, note:"第3章まで", plan:false }],
  dayMeta: {},
};
store["lifecore.v1"] = JSON.stringify(legacyDb);

const sandbox = {
  window:{addEventListener(){}},
  document:{
    addEventListener(){},
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

let ok = true;
const check = (cond, msg) => { if(!cond){ ok=false; console.log("FAIL: "+msg); } else console.log("OK: "+msg); };

// ============ 7. 既存の一部実施データが起動時に自動でマイグレーションされる ============
const occ = vm.runInContext(`db.occurrences.find(o=>o.id==="legacyOcc")`, sandbox);
check(occ.status === "planned", "7a: 旧status='partial'が'planned'（未完了）に変換される");
check(occ.note === "第3章まで", "7b: メモ（進捗の記録）は保持される");
check(occ.actualMin === null, "7c: actualMinはクリアされる");
check(occ.doneAt === null, "7d: doneAtはクリアされる");

// ============ 8. 履歴タブ・傾向タブがクラッシュしないか ============
vm.runInContext(`state.tab="history"; state.histSpan="month"; state.histDate="2026-09-16";`, sandbox);
let threw = false;
try{ vm.runInContext(`renderHistory()`, sandbox); }catch(e){ threw = true; console.log("history threw:", e.message); }
check(!threw, "8a: 履歴タブ（月表示）がエラーなく描画される");
const histHtml = sandbox.document.getElementById("main").innerHTML;
check(!histHtml.includes("一部実施"), "8b: 履歴タブに「一部実施」の文言が残っていない");

threw = false;
try{
  vm.runInContext(`state.histSpan="day";`, sandbox);
  vm.runInContext(`renderHistory()`, sandbox);
}catch(e){ threw = true; console.log("history(day) threw:", e.message); }
check(!threw, "8c: 履歴タブ（日表示）もエラーなく描画される");

// v3.?? で「傾向」は独立タブ・独立関数(renderInsights())ではなくなり、履歴
// タブ内の切替(state.histView==="insights")としてrenderHistory()に統合された
// （renderInsightsはもう存在しない）。現在の実装に合わせて呼び方を更新。
threw = false;
try{
  vm.runInContext(`state.histView = "insights";`, sandbox);
  vm.runInContext(`renderHistory()`, sandbox);
}catch(e){ threw = true; console.log("insights threw:", e.message); }
check(!threw, "8d: 傾向表示（histView=insights）がエラーなく描画される（analyze()のkept()簡素化の影響なし）");

console.log(ok ? "\nSECTION 7-8 ALL PASS" : "\nSECTION 7-8 SOME FAILED");
process.exit(ok?0:1);
