const fs = require("fs");
const vm = require("vm");
const path = require("path");

const appPath = path.join(__dirname, "app.js");
let src = fs.readFileSync(appPath, "utf8");

// minimal DOM mock
function mkEl(id){
  const el = {
    id, value:"", textContent:"", innerHTML:"", dataset:{}, style:{},
    classList:{ add(){}, remove(){}, contains(){return false;}, toggle(){} },
    addEventListener(){}, appendChild(){}, querySelectorAll(){return [];},
    closest(){return null;}, focus(){}, click(){}, getAttribute(){return null;}, setAttribute(){},
  };
  el.querySelector = () => mkEl("");
  return el;
}
const elCache = new Map();
function getEl(id){
  if(!elCache.has(id)) elCache.set(id, mkEl(id));
  return elCache.get(id);
}

const clickListeners = [];
const sandbox = {
  console,
  crypto: require("crypto").webcrypto,
  window: {},
  localStorage: {
    _d: {},
    getItem(k){ return this._d[k] ?? null; },
    setItem(k,v){ this._d[k]=String(v); },
    removeItem(k){ delete this._d[k]; },
  },
  document: {
    getElementById: getEl,
    querySelector(){ return mkEl(""); },
    querySelectorAll(){ return []; },
    addEventListener(evt, fn){ if(evt==="click") clickListeners.push(fn); },
    createElement(){ return mkEl(""); },
    body: mkEl("body"),
    documentElement: mkEl("html"),
  },
  navigator: { userAgent: "node" },
  location: { hash: "", href: "" },
  setInterval(){ return 0; },
  clearInterval(){},
  setTimeout(fn){ return 0; },
  clearTimeout(){},
  requestAnimationFrame(fn){ return 0; },
  matchMedia(){ return { matches:false, addEventListener(){}, addListener(){} }; },
  fetch: undefined,
  alert(){},
  confirm(){ return true; },
  addEventListener(){},
  removeEventListener(){},
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;

vm.createContext(sandbox);
try {
  vm.runInContext(src, sandbox, { filename: "app.js" });
} catch(e) {
  console.error("LOAD ERROR:", e);
  process.exit(1);
}

// app.jsはトップレベルの関数宣言も`let`/`const`も、このNode環境のvmサンドボックス
// には自動で漏れてこない（エンジン依存で保証されない）。他のテストファイルと
// 同じ`globalThis.__t = {...}`方式で明示的に取り出す。
vm.runInContext(
  "globalThis.__t = { seed, db, todayStr, cardHTML, sheetOccEdit, sheetTask, renderToday };",
  sandbox
);
const { seed, todayStr, cardHTML, sheetOccEdit, sheetTask, renderToday } = sandbox.__t;
if(typeof seed === "function") seed();
// seed()はdbを再代入するだけなので、呼んだ後にもう一度__tを取り直す
vm.runInContext("globalThis.__t.db = db;", sandbox);
let db = sandbox.__t.db;

let pass = 0, fail = 0;
function check(name, cond){
  if(cond){ pass++; console.log("PASS:", name); }
  else { fail++; console.log("FAIL:", name); }
}

// --- 1. no "状態：" anywhere in a rendered occurrence card ---
const t = db.tasks.find(x=>x.kind==="single") || db.tasks[0];
const occSingle = { id:"test-occ-1", taskId: t.id, date: todayStr(), plannedStart:"09:00", plannedMin:30, status:"planned", note:"", actualMin:null, doneAt:null, adhoc:false, plan:false };
db.occurrences.push(occSingle);
let html1 = cardHTML(occSingle, true);
check("no 状態： prefix in list card", !html1.includes("状態："));

let html1b = cardHTML(occSingle, false);
check("no 状態： prefix in timeline card", !html1b.includes("状態："));

// --- 2. for repeat-type task in ToDoリスト (listView), note-toggle after range ---
const rt = db.tasks.find(x=>x.kind==="repeat");
const occRepeat = { id:"test-occ-2", taskId: rt.id, date: todayStr(), plannedStart:"10:00", plannedMin:20, status:"planned", note:"進捗あり", actualMin:null, doneAt:null, adhoc:false, plan:false };
db.occurrences.push(occRepeat);
let html2 = cardHTML(occRepeat, true);
const idxRange = html2.indexOf("10:00");
const idxNoteToggle = html2.indexOf("note-toggle");
check("repeat-type card: time appears before note-toggle", idxRange !== -1 && idxNoteToggle !== -1 && idxRange < idxNoteToggle);

// --- 3. sheetOccEdit no longer offers 実際にかかった時間 ---
db.occurrences.push({ id:"test-occ-3", taskId: t.id, date: todayStr(), plannedStart:"11:00", plannedMin:15, status:"done", note:"", actualMin:15, doneAt:"x", adhoc:false, plan:false });
sheetOccEdit("test-occ-3");
const sheetBody = getEl("sheet-body")?.innerHTML || sandbox.__lastSheetHTML || "";
// openSheet likely sets some DOM; let's find via a hook — check function source instead as fallback
const oeSrc = sheetOccEdit.toString();
check("sheetOccEdit source has no oeActual field", !oeSrc.includes("oeActual") && !oeSrc.includes("実際にかかった時間"));

// --- 4. sheetTask uses 備考 label instead of メモ for tkNote ---
const tkSrc = sheetTask.toString();
check("sheetTask uses 備考 label for tkNote", tkSrc.includes("備考（任意）") && tkSrc.includes("tkNote"));
check("sheetTask still has 進捗メモ label for tkProgress", tkSrc.includes("進捗メモ") );

// --- 5. today view switcher has view-seg class ---
const renderTodaySrc = renderToday.toString();
check("renderToday emits view-seg class on today/ToDo switch", renderTodaySrc.includes('class="seg today-seg view-seg"'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
