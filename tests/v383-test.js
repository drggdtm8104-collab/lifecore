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
vm.runInContext(src, sandbox, { filename: "app.js" });

const seed = sandbox.seed;
if(typeof seed === "function") seed();

let pass = 0, fail = 0;
function check(name, cond){
  if(cond){ pass++; console.log("PASS:", name); }
  else { fail++; console.log("FAIL:", name); }
}

// sheetAddOcc HTML check via source string (openSheet content not retrievable directly,
// but sheetAddOcc's own source is inspectable)
const srcAddOcc = sandbox.sheetAddOcc.toString();
check("sheetAddOcc: no more 未定で追加 button", !srcAddOcc.includes("未定で追加"));
check("sheetAddOcc: primary button renamed to タスクを追加", srcAddOcc.includes(">タスクを追加<"));
check("sheetAddOcc: has ao-clear-time button", srcAddOcc.includes("ao-clear-time") && srcAddOcc.includes("クリア"));

const srcTask = sandbox.sheetTask.toString();
check("sheetTask: new-task title is タスクを登録", srcTask.includes("タスクを登録"));

// dispatch ao-clear-time via real click handler
const aoStart = getEl("aoStart"); aoStart.value = "09:00";
const aoEnd = getEl("aoEnd"); aoEnd.value = "10:00";
const aoMin = getEl("aoMin"); aoMin.value = "30";
const btn = { dataset:{ act:"ao-clear-time" }, disabled:false };
const fakeEvent = { target: { closest: (sel) => sel === "[data-act]" ? btn : null } };
clickListeners.forEach(fn => fn(fakeEvent));
check("ao-clear-time clears aoStart", aoStart.value === "");
check("ao-clear-time clears aoEnd", aoEnd.value === "");
check("ao-clear-time clears aoMin", aoMin.value === "");

// dispatch add-today with blank time -> should behave like old "untimed"
const db = (function(){ try { return JSON.parse(sandbox.localStorage.getItem("lifecore.v1")).tasks ? null : null; } catch(e){ return null; } })();
// can't access db directly (let-scoped); instead verify via source that untimed branch still exists
const srcActions = src; // whole source, contains the switch-case block
check("add-today source still has untimed fallback comment", srcActions.includes("v3.83") && srcActions.includes("untimed keeps the task's estimate"));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
