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
const sandbox = {
  window:{addEventListener(){}},
  document:{ addEventListener(){}, getElementById(id){ if(!elCache.has(id)) elCache.set(id, mkEl()); return elCache.get(id); },
    querySelector(){return mkEl();}, querySelectorAll(){return [];}, createElement(){return mkEl();}, body:mkEl() },
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

vm.runInContext(`
  db.tasks.push({ id:"t1", name:"提出書類", kind:"single", done:false, prio:"high",
    due:"2026-09-20", duePrec:"day", startDate:"2026-09-14", startPrec:"day",
    category:"仕事", estMin:null, note:"固定メモ", createdAt:"2026-09-01" });
  db.occurrences.push({ id:"occ1", taskId:"t1", date:"2026-09-16", plannedStart:null, plannedMin:null,
    actualMin:null, status:"planned", doneAt:null, adhoc:false, title:null, note:"", plan:false });
  state.date = "2026-09-16";
  state.todayView = "list";
`, sandbox);
vm.runInContext(`renderToday()`, sandbox);
const html = sandbox.document.getElementById("main").innerHTML;

const gridIdx = html.indexOf("ti-meta grid3");
const memoIdx = html.indexOf("toggle-note");
check(gridIdx !== -1 && memoIdx !== -1 && gridIdx < memoIdx, "メモタブは重要度/開始/期限（grid3）の右側に来る");

console.log(ok ? "\nALL PASS" : "\nSOME FAILED");
process.exit(ok?0:1);
