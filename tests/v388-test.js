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
function getEl(id){
  if(!elCache.has(id)) elCache.set(id, mkEl(id));
  return elCache.get(id);
}

function makeSandbox(fakeStore, localStore, claudeAvailable){
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
  if(claudeAvailable) sandbox.window.claude = { use: async (name) => name === "db" ? fakeDB : null };
  return sandbox;
}

let pass = 0, fail = 0;
function check(name, cond){
  if(cond){ pass++; console.log("PASS:", name); }
  else { fail++; console.log("FAIL:", name); }
}

(async () => {
  // ---- Test 1: render() resilience — content render throws, tabbar must still render ----
  {
    elCache.clear();
    const localStore = {};
    localStore["lifecore.v1"] = JSON.stringify({
      version:1, meta:{savedAt:"2026-09-20T00:00:00.000Z"}, settings:{showOutlook:true},
      templates:[], tasks:[], notes:[], occurrences:[], dayMeta:{},
    });
    const sandbox = makeSandbox({}, localStore, false);
    vm.createContext(sandbox);
    vm.runInContext(src, sandbox, { filename: "app.js" });

    // force the "today" tab content renderer to throw (default state.tab is already "today")
    sandbox.renderToday = () => { throw new Error("simulated render crash"); };
    sandbox.render();

    const tabbarEl = getEl("tabbar");
    const mainEl = getEl("main");
    check("render(): tabbar still rendered after content-render throws", tabbarEl.innerHTML.includes("data-act=\"tab\""));
    check("render(): main area shows a friendly fallback message instead of staying stuck mid-crash", mainEl.innerHTML.includes("再読み込み"));
  }

  // ---- Test 2: loadLocal() corrupt raw -> toast + stash to .corrupt, don't silently vanish ----
  {
    elCache.clear();
    const localStore = {};
    localStore["lifecore.v1"] = "{ this is not valid json !!";
    const sandbox = makeSandbox({}, localStore, false);
    vm.createContext(sandbox);
    vm.runInContext(src, sandbox, { filename: "app.js" });

    check("loadLocal(): corrupt raw stashed to .corrupt key", localStore["lifecore.v1.corrupt"] === "{ this is not valid json !!");
    const toastEl = getEl("toast");
    check("loadLocal(): corrupt-load toast shown", toastEl.hidden === false && toastEl.textContent.includes("読み込めず"));
  }

  // ---- Test 3: normal (non-corrupt) boot shows no spurious toast ----
  {
    elCache.clear();
    const localStore = {};
    localStore["lifecore.v1"] = JSON.stringify({
      version:1, meta:{savedAt:"2026-09-20T00:00:00.000Z"}, settings:{showOutlook:true},
      templates:[], tasks:[], notes:[], occurrences:[], dayMeta:{},
    });
    const sandbox = makeSandbox({}, localStore, false);
    vm.createContext(sandbox);
    vm.runInContext(src, sandbox, { filename: "app.js" });
    const toastEl = getEl("toast");
    check("normal boot: no corrupt-load toast fires", toastEl.hidden !== false);
  }

  // ---- Test 4: sample-fallback adopt path shows the "found no local data" toast ----
  {
    elCache.clear();
    const fakeStore = {};
    const localStore = {};
    const sampleLocal = {
      version: 1, meta: { seeded:true, sample: true, savedAt: "2026-09-20T08:00:00.000Z" },
      settings: { showOutlook: true }, templates: [],
      tasks: [{ id:"seed-task-xyz", name:"サンプル", kind:"single", prio:"mid", note:"", createdAt:"2026-09-20", done:false }],
      notes: [], occurrences: [], dayMeta: {},
    };
    localStore["lifecore.v1"] = JSON.stringify(sampleLocal);
    fakeStore["core/main"] = {
      version: 1, meta: { savedAt: "2026-09-20T09:00:00.000Z" }, settings: { showOutlook: true },
      templates: [], tasks: [{ id:"t-real", name:"本物", kind:"single", prio:"mid", note:"", createdAt:"2026-09-01", done:false }],
      notes: [],
    };
    fakeStore["months/2026-09"] = { month:"2026-09", occ:[], dayMeta:{} };

    const sandbox = makeSandbox(fakeStore, localStore, true);
    vm.createContext(sandbox);
    vm.runInContext(src, sandbox, { filename: "app.js" });
    // v3.97: このシナリオ（この端末がサンプル状態からクラウドの本物データを
    // 採用する）でのトースト表示は、「毎回表示されるのが邪魔」というユーザーの
    // 指摘を受けて廃止された（app/index.htmlのv3.97コメント参照）。現在は
    // デバッグログ（dbg()経由でdebugLogへ）にだけ記録される——letは
    // vmのグローバルに自動で乗らないため、__tで明示的に覗き見る。
    vm.runInContext(`globalThis.__t = { get debugLog(){ return debugLog; } };`, sandbox);
    await sandbox.initDB();
    await new Promise(r => setImmediate(r));

    const toastEl = getEl("toast");
    check("sample-fallback adopt: no intrusive toast is shown (v3.97: replaced by a silent debug-log entry)", toastEl.hidden !== false);
    check("sample-fallback adopt: the event is still recorded in the debug log", sandbox.__t.debugLog.some(l => l.includes("local was sample")));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
