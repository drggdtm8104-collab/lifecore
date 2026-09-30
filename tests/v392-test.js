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

const localStore = {
  "lifecore.v1": JSON.stringify({ version:1, meta:{savedAt:"2026-09-20T00:00:00.000Z"}, settings:{showOutlook:true}, templates:[], tasks:[], notes:[], occurrences:[], dayMeta:{} }),
  "lifecore.v1.premerge": "some-stale-backup",
  "lifecore.v1.corrupt": "some-corrupt-blob",
};

const clickListeners = [];
let reloadCalled = false;
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
  location: { hash: "", href: "", reload(){ reloadCalled = true; } },
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

let pass = 0, fail = 0;
function check(name, cond){
  if(cond){ pass++; console.log("PASS:", name); }
  else { fail++; console.log("FAIL:", name); }
}

function dispatchClick(act, v){
  const btn = { dataset:{ act, v }, disabled:false };
  const fakeEvent = { target: { closest: (sel) => sel === "[data-act]" ? btn : null } };
  clickListeners.forEach(fn => fn(fakeEvent));
}

// 1. click the new button -> should open the confirm sheet, not clear anything yet
dispatchClick("reload-from-cloud");
check("localStorage still intact before confirming", localStore["lifecore.v1"] !== undefined);
check("reload not called yet", !reloadCalled);

// 2. confirm -> should clear local keys and reload
dispatchClick("confirm-yes");
check("lifecore.v1 removed after confirm", localStore["lifecore.v1"] === undefined);
check("lifecore.v1.premerge removed after confirm", localStore["lifecore.v1.premerge"] === undefined);
check("lifecore.v1.corrupt removed after confirm", localStore["lifecore.v1.corrupt"] === undefined);
check("location.reload() called", reloadCalled === true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
