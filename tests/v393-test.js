const fs = require("fs");
const vm = require("vm");
const path = require("path");

const appPath = path.join(__dirname, "app.js");
let src = fs.readFileSync(appPath, "utf8");

function mkEl(id){
  const el = {
    id, value:"", textContent:"", innerHTML:"", dataset:{}, style:{}, hidden:false,
    classList:{ add(){}, remove(){}, contains(){return false;}, toggle(){} },
    addEventListener(){}, appendChild(){}, querySelectorAll(){return [];},
    closest(){return null;}, focus(){}, click(){}, getAttribute(){return null;}, setAttribute(){},
  };
  el.querySelector = () => mkEl("");
  return el;
}
const elCache = new Map();
function getEl(id){ if(!elCache.has(id)) elCache.set(id, mkEl(id)); return elCache.get(id); }

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
    addEventListener(evt, fn){},
    createElement(){ return mkEl(""); },
    body: mkEl("body"),
    documentElement: mkEl("html"),
  },
  navigator: { userAgent: "node" },
  location: { hash: "", href: "" },
  setInterval(){ return 0; },
  clearInterval(){},
  setTimeout(fn, ms){ return 0; },
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
vm.runInContext(src, sandbox, { filename: "app.js" });
// byPrioFlat etc. are `const`, so they never attach to the global object —
// expose them explicitly via an in-context assignment (a plain property
// write onto globalThis, which IS the sandbox object, does cross out).
vm.runInContext(
  "globalThis.__t = { byPrioFlat, byDueFlat, byCreated, startBucketForPrio, startBucketForDue };",
  sandbox
);
const T = sandbox.__t;

let pass = 0, fail = 0;
function check(name, cond){
  if(cond){ pass++; console.log("PASS:", name); }
  else { fail++; console.log("FAIL:", name); }
}

// ---- 重要度順 (byPrioFlat): same prio/due -> startBucketForPrio (startable -> none -> future) -> createdAt ----
{
  const A = { id:"A", prio:"mid", due:"2026-10-01", startDate:"2026-09-01", createdAt:"2026-09-01" }; // startable (past)
  const B = { id:"B", prio:"mid", due:"2026-10-01", startDate:null, createdAt:"2026-09-02" };          // no setting
  const C = { id:"C", prio:"mid", due:"2026-10-01", startDate:"2026-12-01", createdAt:"2026-09-03" };  // future
  const sorted = [C,B,A].sort(T.byPrioFlat).map(t=>t.id);
  check("byPrioFlat: startable -> none -> future", JSON.stringify(sorted) === JSON.stringify(["A","B","C"]));
}
{
  const D = { id:"D", prio:"mid", due:"2026-10-01", startDate:null, createdAt:"2026-09-05" };
  const E = { id:"E", prio:"mid", due:"2026-10-01", startDate:null, createdAt:"2026-09-04" };
  const sorted = [D,E].sort(T.byPrioFlat).map(t=>t.id);
  check("byPrioFlat: tie on startBucket -> older createdAt first", JSON.stringify(sorted) === JSON.stringify(["E","D"]));
}
{
  // prio takes priority over everything else
  const High = { id:"High", prio:"high", due:"2026-12-31", startDate:null, createdAt:"2026-09-10" };
  const Low  = { id:"Low",  prio:"low",  due:"2026-09-25", startDate:"2026-09-01", createdAt:"2026-09-01" };
  const sorted = [Low, High].sort(T.byPrioFlat).map(t=>t.id);
  check("byPrioFlat: prio beats due/start/created", JSON.stringify(sorted) === JSON.stringify(["High","Low"]));
}

// ---- 期限順 (byDueFlat): same due/prio -> startBucketForDue (has-date, by date asc -> none) -> createdAt ----
{
  const F = { id:"F", due:"2026-10-05", prio:"low", startDate:"2026-09-10", createdAt:"2026-09-01" };
  const G = { id:"G", due:"2026-10-05", prio:"low", startDate:null, createdAt:"2026-09-02" };
  const sorted = [G,F].sort(T.byDueFlat).map(t=>t.id);
  check("byDueFlat: has startDate before none", JSON.stringify(sorted) === JSON.stringify(["F","G"]));
}
{
  const H = { id:"H", due:"2026-10-05", prio:"low", startDate:"2026-12-01", createdAt:"2026-09-01" };
  const I = { id:"I", due:"2026-10-05", prio:"low", startDate:"2026-09-05", createdAt:"2026-09-02" };
  const sorted = [H,I].sort(T.byDueFlat).map(t=>t.id);
  check("byDueFlat: among has-startDate, earlier startDate first", JSON.stringify(sorted) === JSON.stringify(["I","H"]));
}
{
  const due1 = { id:"due1", due:"2026-09-25", prio:"high", startDate:null, createdAt:"2026-09-01" };
  const due2 = { id:"due2", due:"2026-10-30", prio:"low", startDate:null, createdAt:"2026-09-01" };
  const sorted = [due2, due1].sort(T.byDueFlat).map(t=>t.id);
  check("byDueFlat: due date is primary axis", JSON.stringify(sorted) === JSON.stringify(["due1","due2"]));
}

// ---- 継続型: routine group before skill group; each sorted by createdAt asc ----
{
  const src2 = sandbox.renderTasks.toString();
  check("renderTasks: routine group listed before skill group", src2.indexOf('["routine","ルーティン"]') < src2.indexOf('["skill","スキル"]') && src2.includes('.sort(byCreated)'));
}
{
  const src3 = sandbox.sheetTodayPick.toString();
  check("sheetTodayPick: routine group listed before skill group", src3.indexOf('["routine","ルーティン"]') < src3.indexOf('["skill","スキル"]') && src3.includes('.sort(byCreated)'));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

