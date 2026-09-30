const fs = require("fs");
const vm = require("vm");
const path = require("path");

const appPath = path.join(__dirname, "app.js");
let src = fs.readFileSync(appPath, "utf8");

function mkEl(id){
  const el = {
    id, value:"", textContent:"", innerHTML:"", dataset:{}, style:{}, hidden: id === "toast" ? true : false,
    classList:{ add(){}, remove(){}, contains(){return false;}, toggle(){} },
    addEventListener(){}, appendChild(){}, querySelectorAll(){return [];},
    closest(){return null;}, focus(){}, click(){}, getAttribute(){return null;}, setAttribute(){},
  };
  el.querySelector = () => mkEl("");
  return el;
}
const elCache = new Map();
function getEl(id){ if(!elCache.has(id)) elCache.set(id, mkEl(id)); return elCache.get(id); }

// ---- fake cloud store with onSnapshot support ----
const fakeStore = {};
const snapshotCbs = {}; // path -> [cb, ...]
class FakeDoc {
  constructor(p){ this.p = p; }
  async get(){ const d = fakeStore[this.p]; return { exists: d !== undefined, data: () => d }; }
  async set(data){
    fakeStore[this.p] = JSON.parse(JSON.stringify(data));
    (snapshotCbs[this.p] || []).forEach(cb => { try{ cb({ metadata: { hasPendingWrites: false } }); }catch(e){} });
  }
  async delete(){ delete fakeStore[this.p]; }
  onSnapshot(cb, errCb){ (snapshotCbs[this.p] = snapshotCbs[this.p] || []).push(cb); return () => {}; }
}
class FakeCollection {
  constructor(prefix){ this.prefix = prefix; }
  async get(){
    const docs = Object.keys(fakeStore)
      .filter(k => k.startsWith(this.prefix + "/"))
      .map(k => ({ id: k.slice(this.prefix.length + 1), data: () => fakeStore[k] }));
    return { docs };
  }
  onSnapshot(cb, errCb){ (snapshotCbs[this.prefix] = snapshotCbs[this.prefix] || []).push(cb); return () => {}; }
}
const fakeDB = { doc: p => new FakeDoc(p), collection: p => new FakeCollection(p) };

const localStore = {};
const clickListeners = [];
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
    addEventListener(evt, fn){ if(evt==="click") clickListeners.push(fn); },
    createElement(){ return mkEl(""); },
    body: mkEl("body"),
    documentElement: mkEl("html"),
  },
  navigator: { userAgent: "node" },
  location: { hash: "", href: "" },
  setInterval(){ return 0; },
  clearInterval(){},
  // Real setTimeout ONLY for delays >=100ms (subscribeDB's react() debounces at
  // 600ms) so it actually fires for this test. The script's own bottom-of-file
  // auto-boot uses a 50ms timer to kick off initDB() — that one must stay
  // suppressed here since this test drives initDB()/subscribeDB() manually,
  // and letting both fire double-boots the sync logic and corrupts the test.
  setTimeout: (fn, ms) => (ms >= 100 ? setTimeout(fn, Math.min(ms, 50)) : 0),
  clearTimeout: (id) => clearTimeout(id),
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

// pre-seed local == cloud initial state (same content, so the boot path is the
// simple "push local, dbReady=true" branch — no adopt/merge noise at boot)
const initialCore = {
  version: 1, meta: { savedAt: "2026-09-20T00:00:00.000Z" }, settings: { showOutlook: true },
  templates: [], tasks: [{ id:"t-shared", name:"共有タスク", kind:"single", prio:"low", note:"", createdAt:"2026-09-01", done:false }],
  notes: [], occurrences: [], dayMeta: {},
};
localStore["lifecore.v1"] = JSON.stringify(initialCore);
fakeStore["core/main"] = JSON.parse(JSON.stringify(initialCore));
fakeStore["months/2026-09"] = { month:"2026-09", occ:[], dayMeta:{} };

vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: "app.js" });

let pass = 0, fail = 0;
function check(name, cond){
  if(cond){ pass++; console.log("PASS:", name); }
  else { fail++; console.log("FAIL:", name); }
}

function dispatchClick(act, v, id){
  const btn = { dataset:{ act, v, id }, disabled:false };
  const fakeEvent = { target: { closest: (sel) => sel === "[data-act]" ? btn : null } };
  clickListeners.forEach(fn => fn(fakeEvent));
}

(async () => {
  await sandbox.initDB();
  await new Promise(r => setImmediate(r));

  // create a genuine local-only task through the real UI flow (not yet in "cloud" fresh state)
  sandbox.sheetTask(null);
  getEl("tkName").value = "この端末だけのタスク";
  dispatchClick("save-task");
  // let this device's own push (and this mock's onSnapshot echo of its own
  // write — the mock doesn't model Firestore's hasPendingWrites distinction
  // that the real code filters on) fully settle BEFORE subscribing, so the
  // subscription below only reacts to the deliberate "other device" update.
  await new Promise(r => setTimeout(r, 150));

  check("local-only task landed in this device's localStorage", (() => {
    const d = JSON.parse(localStore["lifecore.v1"]);
    return d.tasks.some(t => t.name === "この端末だけのタスク");
  })());

  // SYNC_STEP=3 in the shipped build means initDB() never calls subscribeDB()
  // itself (it's currently-dead code, staged for a future step bump) — call
  // it directly here to test the fixed logic in isolation.
  sandbox.subscribeDB();

  // simulate another device pushing a change: cloud now has a NEW task this
  // device has never seen, but does NOT have "この端末だけのタスク"
  fakeStore["core/main"] = {
    version: 1, meta: { savedAt: "2026-09-20T01:00:00.000Z" }, settings: { showOutlook: true },
    templates: [], tasks: [
      { id:"t-shared", name:"共有タスク", kind:"single", prio:"low", note:"", createdAt:"2026-09-01", done:false },
      { id:"t-other-device", name:"他端末で追加したタスク", kind:"single", prio:"low", note:"", createdAt:"2026-09-20", done:false },
    ],
    notes: [], occurrences: [], dayMeta: {},
  };
  (snapshotCbs["core/main"] || []).forEach(cb => cb({ metadata: { hasPendingWrites: false } }));

  // wait for the (shortened) 600ms debounce + async chain to settle
  await new Promise(r => setTimeout(r, 200));

  const finalLocal = JSON.parse(localStore["lifecore.v1"]);
  check("after remote update: local-only task SURVIVES (not wiped by remote merge)",
    finalLocal.tasks.some(t => t.name === "この端末だけのタスク"));
  check("after remote update: other-device's task is present too",
    finalLocal.tasks.some(t => t.id === "t-other-device"));
  check("after remote update: originally-shared task still present",
    finalLocal.tasks.some(t => t.id === "t-shared"));

  const pushedCore = fakeStore["core/main"];
  check("merged result was pushed back to the cloud (local-only task reached the cloud doc)",
    pushedCore.tasks.some(t => t.name === "この端末だけのタスク"));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
