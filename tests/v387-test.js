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

function makeSandbox(fakeStore, localStore){
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
  sandbox.window.claude = { use: async (name) => name === "db" ? fakeDB : null };
  return sandbox;
}

let pass = 0, fail = 0;
function check(name, cond){
  if(cond){ pass++; console.log("PASS:", name); }
  else { fail++; console.log("FAIL:", name); }
}

(async () => {
  // ---- Scenario A: genuine offline edit (local NOT sample) — must still merge & survive ----
  {
    const fakeStore = {};
    const localStore = {};
    const localCore = {
      version: 1,
      meta: { savedAt: "2026-09-19T10:00:00.000Z" },   // real data, NOT sample
      settings: { showOutlook: true },
      templates: [],
      tasks: [{ id:"t1", name:"サンプルタスク", kind:"single", prio:"mid", note:"", createdAt:"2026-09-01", done:false }],
      notes: [{ id:"n-offline", title:"", body:"オフラインで書いたメモ", createdAt:"2026-09-19T10:00:00.000Z", updatedAt:"2026-09-19T10:00:00.000Z" }],
      occurrences: [],
      dayMeta: {},
    };
    localStore["lifecore.v1"] = JSON.stringify(localCore);
    const cloudCore = {
      version: 1, meta: { savedAt: "2026-09-20T09:00:00.000Z" }, settings: { showOutlook: true },
      templates: [], tasks: [{ id:"t1", name:"サンプルタスク", kind:"single", prio:"mid", note:"", createdAt:"2026-09-01", done:false }],
      notes: [],
    };
    fakeStore["core/main"] = cloudCore;
    fakeStore["months/2026-09"] = { month:"2026-09", occ:[], dayMeta:{} };

    const sandbox = makeSandbox(fakeStore, localStore);
    vm.createContext(sandbox);
    vm.runInContext(src, sandbox, { filename: "app.js" });
    await sandbox.initDB();
    await new Promise(r => setImmediate(r));

    const savedLocal = JSON.parse(localStore["lifecore.v1"]);
    check("A: real offline note survives merge (not sample)", savedLocal.notes.some(n => n.id === "n-offline"));
    check("A: offline note got pushed to cloud too", fakeStore["core/main"].notes.some(n => n.id === "n-offline"));
  }

  // ---- Scenario B: local fell back to seed() (meta.sample=true) — must NOT merge junk in ----
  {
    const fakeStore = {};
    const localStore = {};
    // simulate loadLocal() having fallen back to seed(): mark meta.sample=true,
    // give it some "phantom" sample-looking note/task with fresh random-ish ids
    const sampleLocal = {
      version: 1,
      meta: { seeded:true, sample: true, savedAt: "2026-09-20T08:00:00.000Z" },
      settings: { showOutlook: true },
      templates: [],
      tasks: [{ id:"seed-task-xyz", name:"サンプル: 資格勉強", kind:"single", prio:"mid", note:"", createdAt:"2026-09-20", done:false }],
      notes: [{ id:"seed-note-abc", title:"", body:"（サンプル）買い物リスト", createdAt:"2026-09-20T08:00:00.000Z", updatedAt:"2026-09-20T08:00:00.000Z" }],
      occurrences: [],
      dayMeta: {},
    };
    localStore["lifecore.v1"] = JSON.stringify(sampleLocal);
    // cloud has the user's REAL data (their genuine note), timestamped newer
    const cloudCore = {
      version: 1, meta: { savedAt: "2026-09-20T09:00:00.000Z" }, settings: { showOutlook: true },
      templates: [], tasks: [{ id:"t-real", name:"本物のタスク", kind:"single", prio:"mid", note:"", createdAt:"2026-09-01", done:false }],
      notes: [{ id:"n-real", title:"", body:"本物のメモ", createdAt:"2026-09-18T00:00:00.000Z", updatedAt:"2026-09-18T00:00:00.000Z" }],
    };
    fakeStore["core/main"] = cloudCore;
    fakeStore["months/2026-09"] = { month:"2026-09", occ:[], dayMeta:{} };

    const sandbox = makeSandbox(fakeStore, localStore);
    vm.createContext(sandbox);
    vm.runInContext(src, sandbox, { filename: "app.js" });
    await sandbox.initDB();
    await new Promise(r => setImmediate(r));

    const savedLocal = JSON.parse(localStore["lifecore.v1"]);
    check("B: sample task NOT merged into real data", !savedLocal.tasks.some(t => t.id === "seed-task-xyz"));
    check("B: sample note NOT merged into real data", !savedLocal.notes.some(n => n.id === "seed-note-abc"));
    check("B: real cloud note IS present after replace", savedLocal.notes.some(n => n.id === "n-real"));
    check("B: real cloud task IS present after replace", savedLocal.tasks.some(t => t.id === "t-real"));
    check("B: cloud store NOT polluted with sample items",
      !fakeStore["core/main"].notes.some(n => n.id === "seed-note-abc") &&
      !fakeStore["core/main"].tasks.some(t => t.id === "seed-task-xyz"));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
