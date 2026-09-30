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

const phantomIds = ["0e066a0a","6ca52970","de034bc5","b7d93ef3","bd1e3de8","4c90888d","5577b559","1d564984","0de1a48a","07858496","24446b30","5602f258","b269b4a8","7ffaf36e","06df156f","c9221e46","a94c6bc0","2acda6e8"];

const contaminatedLocal = {
  version: 1,
  meta: { savedAt: "2026-09-19T18:00:00.000Z" },
  settings: { showOutlook: true },
  templates: [],
  tasks: [
    { id: "real-task-1", name: "本物のタスク", kind:"single", prio:"mid", note:"", createdAt:"2026-09-01", done:false },
    ...phantomIds.map(id => ({ id, name:"サンプル", kind:"repeat", freq:{type:"daily"}, estMin:15, prio:"low", rtype:"routine", startDate:null, startPrec:"day", duePrec:"day", category:"食事", done:false, createdAt:"2026-09-19" })),
  ],
  notes: [],
  occurrences: [
    { id:"occ-real", taskId:"real-task-1", date:"2026-09-19", plannedStart:null, plannedMin:null, status:"planned", actualMin:null, doneAt:null, adhoc:false, note:"" },
    ...phantomIds.map((id,i) => ({ id:"occ-phantom-"+i, taskId:id, date:"2026-09-14", plannedStart:"08:20", plannedMin:null, status:"done", actualMin:0, doneAt:"2026-09-14T08:20", adhoc:false, note:"" })),
  ],
  dayMeta: {},
};

const localStore = { "lifecore.v1": JSON.stringify(contaminatedLocal) };
const sandbox = {
  console,
  crypto: require("crypto").webcrypto,
  window: {},
  localStorage: {
    getItem(k){ return Object.prototype.hasOwnProperty.call(localStore, k) ? localStore[k] : null; },
    setItem(k,v){ localStore[k]=String(v); },
    removeItem(k){ delete localStore[k]; },
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
  setTimeout(fn, ms){ return 0; },   // prevent the real initDB() boot call from firing during this test
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

let pass = 0, fail = 0;
function check(name, cond){
  if(cond){ pass++; console.log("PASS:", name); }
  else { fail++; console.log("FAIL:", name); }
}

// db is let-scoped and can't be read directly; verify via migrate()'s effect through
// a fresh call, since migrate is a plain function attached to sandbox globally.
const cleaned = sandbox.migrate(JSON.parse(JSON.stringify(contaminatedLocal)));

check("all 18 phantom tasks stripped", !cleaned.tasks.some(t => phantomIds.includes(t.id)));
check("real task survives", cleaned.tasks.some(t => t.id === "real-task-1"));
check("all phantom occurrences stripped", !cleaned.occurrences.some(o => phantomIds.includes(o.taskId)));
check("real occurrence survives", cleaned.occurrences.some(o => o.id === "occ-real"));
check("task count is 1 (only the real one) plus any auto-created 食事 repeats", cleaned.tasks.length >= 1);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
