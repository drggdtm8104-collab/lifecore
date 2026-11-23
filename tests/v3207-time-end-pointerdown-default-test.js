const fs = require("fs");
const vm = require("vm");
const path = require("path");

const src = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");

let fail = 0;
function ok(name, cond){
  if(cond){ console.log("PASS", name); } else { console.log("FAIL", name); fail++; }
}

function mkEl(id){
  let html = "";
  const el = {
    id, value:"", textContent:"", hidden:false, type:"time", tagName:"INPUT",
    dataset:{}, style:{}, children:[], _attrs:{},
    classList:{ add(){}, remove(){}, toggle(){}, contains(){return false;} },
    addEventListener(){}, appendChild(){}, querySelectorAll(){return [];},
    closest(){return null;}, focus(){}, click(){},
    setAttribute(name, v){ el._attrs[name] = v; },
    removeAttribute(){}, getAttribute(name){ return el._attrs[name] ?? null; },
    get innerHTML(){ return html; }, set innerHTML(v){ html = v; },
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
const pointerdownListeners = [];
const touchstartListeners = [];
const focusinListeners = [];
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
    addEventListener(evt, fn){
      if(evt==="click") clickListeners.push(fn);
      if(evt==="pointerdown") pointerdownListeners.push(fn);
      if(evt==="touchstart") touchstartListeners.push(fn);
      if(evt==="focusin") focusinListeners.push(fn);
    },
    createElement(){ return mkEl(""); },
    body: mkEl("body"),
    documentElement: mkEl("html"),
  },
  navigator: { userAgent: "node", onLine: true, serviceWorker: undefined },
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
try{
  vm.runInContext(src, sandbox, { filename: "app.js" });
}catch(e){
  console.log("SCRIPT THREW ON LOAD:", e.message);
  process.exit(1);
}

function dispatchPointerdown(el){ const evt = { target: el }; pointerdownListeners.forEach(fn=>fn(evt)); }
function dispatchTouchstart(el){ const evt = { target: el }; touchstartListeners.forEach(fn=>fn(evt)); }

// v3.207: v3.206の"focusin"ベースの対策でも実機で直らなかったとの報告を
// 受け、ネイティブの時刻ピッカーが開くより確実に早い"pointerdown"/
// "touchstart"（指が触れた最初の瞬間）でも同じ既定値補完をするよう
// 追加した。あわせてIDLプロパティ(.value)だけでなくcontent属性
// (value="...")も明示的に設定するようにした（属性を見て初期表示を
// 決める実装への対策）。

// 1) pointerdownで、空欄の終了欄に開始時刻が入り、value属性も設定される。
{
  const start = getEl("mkStart"); start.value = "11:00";
  const end = getEl("mkEnd"); end.value = ""; end._attrs = {};
  dispatchPointerdown(end);
  ok("pointerdown on an empty End field defaults its .value to Start's", end.value === "11:00");
  ok("pointerdown also sets the value content attribute (for widgets that read it)", end._attrs.value === "11:00");
}

// 2) touchstartでも同様。
{
  const start = getEl("oeStart"); start.value = "15:30";
  const end = getEl("oeEnd"); end.value = ""; end._attrs = {};
  dispatchTouchstart(end);
  ok("touchstart on an empty End field defaults its .value to Start's", end.value === "15:30");
}

// 3) 既に終了欄に値がある場合は、pointerdown/touchstartでも上書きしない。
{
  const start = getEl("mkStart"); start.value = "11:00";
  const end = getEl("mkEnd"); end.value = "20:00"; end._attrs = {};
  dispatchPointerdown(end);
  ok("pointerdown on an already-set End field doesn't overwrite it", end.value === "20:00");
}

// 4) 開始欄も空欄なら、pointerdownしても何も起きない（例外も無い）。
{
  let threw = false;
  try{
    const start = getEl("aoStart"); start.value = "";
    const end = getEl("aoEnd"); end.value = ""; end._attrs = {};
    dispatchPointerdown(end);
    ok("End stays empty when Start is also empty (pointerdown)", end.value === "");
  }catch(e){ threw = true; }
  ok("pointerdown on End with an empty Start doesn't throw", !threw);
}

console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAILURES`);
process.exit(fail ? 1 : 0);
