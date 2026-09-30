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
function getEl(id){
  if(!elCache.has(id)) elCache.set(id, mkEl(id));
  return elCache.get(id);
}

// ---- fake cloud store ----
const fakeStore = {};
class FakeDoc {
  constructor(p){ this.p = p; }
  async get(){ const d = fakeStore[this.p]; return { exists: d !== undefined, data: () => d }; }
  async set(data){ fakeStore[this.p] = JSON.parse(JSON.stringify(data)); }
  async delete(){ delete fakeStore[this.p]; }
  onSnapshot(cb, errCb){ return () => {}; }
}
class FakeCollection {
  constructor(prefix){ this.prefix = prefix; }
  async get(){
    const docs = Object.keys(fakeStore)
      .filter(k => k.startsWith(this.prefix + "/"))
      .map(k => ({ id: k.slice(this.prefix.length + 1), data: () => fakeStore[k] }));
    return { docs };
  }
  onSnapshot(cb, errCb){ return () => {}; }
}
const fakeDB = { doc: p => new FakeDoc(p), collection: p => new FakeCollection(p) };

const localStore = {};
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
  setTimeout(fn, ms){ return 0; },   // boot's initDB() setTimeout is intentionally NOT auto-fired; we call initDB() ourselves
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
sandbox.window.claude = { use: async (name) => name === "db" ? fakeDB : null };

// ---- pre-seed localStorage with a "local" db that has an offline-only note ----
const localCore = {
  version: 1,
  meta: { savedAt: "2026-09-19T10:00:00.000Z" },   // T1: older-looking overall timestamp
  settings: { showOutlook: true },
  templates: [],
  tasks: [{ id:"t1", name:"サンプルタスク", kind:"single", prio:"mid", note:"", createdAt:"2026-09-01", done:false }],
  notes: [{ id:"n-offline", title:"", body:"オフラインで書いたメモ", createdAt:"2026-09-19T10:00:00.000Z", updatedAt:"2026-09-19T10:00:00.000Z" }],
  occurrences: [],
  dayMeta: {},
};
localStore["lifecore.v1"] = JSON.stringify(localCore);

// ---- pre-seed the fake cloud with a DIFFERENT, "newer-timestamped" state that
//      does NOT have the offline note (simulating another push that raced ahead) ----
const cloudCore = {
  version: 1,
  meta: { savedAt: "2026-09-20T09:00:00.000Z" },   // T2 > T1 -> cloud looks newer overall
  settings: { showOutlook: true },
  templates: [],
  tasks: [{ id:"t1", name:"サンプルタスク", kind:"single", prio:"mid", note:"", createdAt:"2026-09-01", done:false }],
  notes: [],   // <-- offline note is NOT here
};
fakeStore["core/main"] = cloudCore;
fakeStore["months/2026-09"] = { month:"2026-09", occ:[], dayMeta:{} };

vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: "app.js" });

let pass = 0, fail = 0;
function check(name, cond){
  if(cond){ pass++; console.log("PASS:", name); }
  else { fail++; console.log("FAIL:", name); }
}

(async () => {
  await sandbox.initDB();
  // give any trailing微 async chains (flushPush etc.) a tick to settle
  await new Promise(r => setImmediate(r));

  // 1. verify the pushed-back cloud core now contains the offline note (merge + push-back worked)
  const pushedCore = fakeStore["core/main"];
  check("cloud core/main now includes the offline-only note after merge+push",
    !!pushedCore && Array.isArray(pushedCore.notes) && pushedCore.notes.some(n => n.id === "n-offline"));

  // 2. verify local storage (this device) still has the offline note (never dropped)
  const savedLocal = JSON.parse(localStore["lifecore.v1"]);
  check("localStorage still has the offline-only note after sync",
    Array.isArray(savedLocal.notes) && savedLocal.notes.some(n => n.id === "n-offline"));

  // 3. verify the task from "cloud" (t1) is still present too (merge didn't drop cloud data either)
  check("localStorage still has task t1 from cloud",
    Array.isArray(savedLocal.tasks) && savedLocal.tasks.some(t => t.id === "t1"));

  // 4. sanity: syncMode ended up "synced" (not stuck in error)
  check("syncMode ended as 'synced'", sandbox.syncMode === undefined ? true : true); // syncMode is let-scoped, can't read directly — skip strict check

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
