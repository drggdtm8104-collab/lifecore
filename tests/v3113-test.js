const fs = require("fs");
const vm = require("vm");
const path = require("path");

const src = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");

let fail = 0;
function ok(name, cond){
  if(cond){ console.log("PASS", name); } else { console.log("FAIL", name); fail++; }
}

function mkEl(){
  const listeners = {};
  const el = {
    _html: "", value: "", files: null,
    classList: { add(){}, remove(){}, toggle(){}, contains(){return false;} },
    style: {}, dataset: {}, children: [],
    addEventListener(ev, fn){ (listeners[ev] = listeners[ev]||[]).push(fn); },
    querySelector(){ return mkEl(); },
    querySelectorAll(){ return []; },
    closest(){ return null; },
    appendChild(){}, remove(){}, focus(){}, select(){}, click(){},
    get innerHTML(){ return this._html; },
    set innerHTML(v){ this._html = v; },
    getAttribute(){ return null; }, setAttribute(){},
    __listeners: listeners,
  };
  return el;
}

const documentListeners = {};
const M = mkEl();
const FAB = mkEl();
const FABM = mkEl(); FABM.hidden = true;
const elStore = { main: M, fab: FAB, fabMenu: FABM };

const fakeDocument = {
  addEventListener(ev, fn){ (documentListeners[ev] = documentListeners[ev]||[]).push(fn); },
  getElementById(id){ if(!elStore[id]) elStore[id] = mkEl(); return elStore[id]; },
  querySelector(){ return mkEl(); },
  querySelectorAll(){ return []; },
  createElement(){ return mkEl(); },
  body: mkEl(), documentElement: mkEl(),
};

let lastObjectUrlBlob = null;
const sandbox = {
  document: fakeDocument, window: {}, console,
  localStorage: (function(){
    let store = {};
    return {
      getItem(k){ return store[k]===undefined?null:store[k]; },
      setItem(k,v){ store[k]=String(v); },
      removeItem(k){ delete store[k]; },
    };
  })(),
  navigator: { onLine: true, serviceWorker: undefined, clipboard: { writeText: ()=>Promise.resolve() } },
  fetch: async ()=>({ ok:false }),
  setTimeout, clearTimeout, setInterval, clearInterval,
  requestAnimationFrame: (fn)=>setTimeout(fn,0),
  history: { replaceState(){} },
  location: { hash:"", search:"", href:"http://localhost/" },
  alert: ()=>{}, confirm: ()=>true,
  Notification: undefined, visualViewport: undefined,
  performance: { now:()=>Date.now() },
  crypto: require("crypto").webcrypto || {
    randomUUID(){ return require("crypto").randomUUID(); },
    getRandomValues(arr){ return require("crypto").randomFillSync(arr); },
  },
  Blob: function(parts, opts){ this.parts = parts; this.type = opts && opts.type; },
  URL: {
    createObjectURL(blob){ lastObjectUrlBlob = blob; return "blob:fake-url"; },
    revokeObjectURL(){},
  },
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.addEventListener = function(){};
sandbox.removeEventListener = function(){};
sandbox.matchMedia = function(){ return { matches:false, addEventListener(){}, removeEventListener(){}, addListener(){}, removeListener(){} }; };

vm.createContext(sandbox);
try{
  vm.runInContext(src, sandbox, { filename: "app.js" });
}catch(e){
  console.log("SCRIPT THREW ON LOAD:", e.message);
  process.exit(1);
}
vm.runInContext(`globalThis.__t = { get db(){ return db; }, set db(v){ db=v; }, get state(){ return state; }, render };`, sandbox);
const T = sandbox.__t;

function dispatchClick(target){
  const handlers = documentListeners["click"] || [];
  const evt = { target, preventDefault(){}, stopPropagation(){} };
  handlers.forEach(fn=>fn(evt));
}
function dispatchChange(target){
  const handlers = documentListeners["change"] || [];
  const evt = { target, preventDefault(){}, stopPropagation(){} };
  handlers.forEach(fn=>fn(evt));
}
function fakeTarget(dataAct, dataV, dataId){
  const t = mkEl();
  t.dataset = { act: dataAct, v: dataV, id: dataId };
  t.closest = function(sel){ if(sel === "[data-act]") return t; return null; };
  t.getAttribute = function(attr){
    if(attr==="data-act") return dataAct;
    if(attr==="data-v") return dataV;
    if(attr==="data-id") return dataId;
    return null;
  };
  return t;
}

// -------- Test 1: download-export creates a Blob containing the current db JSON --------
T.state.tab = "settings";
T.render();
dispatchClick(fakeTarget("download-export"));
ok("download-export created a Blob via URL.createObjectURL", !!lastObjectUrlBlob);
ok("the Blob's content is valid JSON matching the current db", (() => {
  try{
    const text = lastObjectUrlBlob.parts[0];
    const parsed = JSON.parse(text);
    return Array.isArray(parsed.tasks) && Array.isArray(parsed.occurrences);
  }catch(e){ return false; }
})());

// -------- Test 1c (v3.114): downloaded filename includes minute-level time,
// not just the date --------
ok("source builds the download filename with hours+minutes",
  src.includes("now.getHours()") && src.includes("now.getMinutes()") && src.includes("lifecore-backup-${stamp}.json"));
ok("source no longer names the file using only todayStr() (schedule-day date, no time)",
  !/a\.download = `lifecore-backup-\$\{todayStr\(\)\}\.json`/.test(src));

// -------- Test 1b: inside Artifact (window.claude present), download-export
// falls back to copy instead of silently doing nothing (a plain <a download>
// is a no-op in the Artifact viewer) --------
sandbox.window.claude = { use: () => Promise.resolve(null) };
lastObjectUrlBlob = null;
let copiedText = null;
sandbox.navigator.clipboard.writeText = (t) => { copiedText = t; return Promise.resolve(); };
dispatchClick(fakeTarget("download-export"));
ok("inside Artifact, no Blob/ObjectURL download is attempted", lastObjectUrlBlob === null);
ok("inside Artifact, it falls back to copying the export text instead (writeText was actually called)", copiedText !== null);
delete sandbox.window.claude;

// -------- Test 2: selecting a file via #importFile populates the importBox textarea --------
const fakeJson = JSON.stringify({ version:1, tasks:[], templates:[], occurrences:[], notes:[], remarks:[], dayMeta:{} });
const fileEl = mkEl();
fileEl.id = "importFile";
fileEl.files = [{ text: () => Promise.resolve(fakeJson) }];
dispatchChange(fileEl);

// file.text() resolves async — flush microtasks
Promise.resolve().then(() => Promise.resolve()).then(() => {
  const box = fakeDocument.getElementById("importBox");
  ok("importBox textarea was populated with the file's content", box.value === fakeJson);
  ok("the file input's own value was cleared after reading", fileEl.value === "");

  console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAILURES`);
  process.exit(fail ? 1 : 0);
});
