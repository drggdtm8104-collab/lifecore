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
    dataset:{}, style:{}, children:[],
    classList:{ add(){}, remove(){}, toggle(){}, contains(){return false;} },
    addEventListener(){}, appendChild(){}, querySelectorAll(){return [];},
    closest(){return null;}, focus(){}, click(){},
    setAttribute(){}, removeAttribute(){}, getAttribute(){return null;},
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
const changeListeners = [];
const inputListeners = [];
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
      if(evt==="change") changeListeners.push(fn);
      if(evt==="input") inputListeners.push(fn);
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

function dispatchClick(dataAct, extra){
  const t = mkEl();
  t.dataset = Object.assign({ act: dataAct }, extra||{});
  t.closest = function(sel){ if(sel === "[data-act]") return t; return null; };
  const evt = { target: t, preventDefault(){}, stopPropagation(){} };
  clickListeners.forEach(fn=>fn(evt));
  return t;
}
function dispatchFocusin(el){ const evt = { target: el }; focusinListeners.forEach(fn=>fn(evt)); }
function dispatchInput(el){ const evt = { target: el }; inputListeners.forEach(fn=>fn(evt)); }

// v3.206: 実機（モバイルSafari等）では、開始欄の"change"が確実に発火せず、
// 終了欄が空欄のまま——タップするとブラウザ標準の「現在時刻」が
// 表示されるだけに見える不具合の報告を受けての追加対応。
// 「終了欄そのものにフォーカスが入った瞬間」に既定値を入れる経路を
// 新設し、開始側のイベント発火に依存しないようにした。

// 1) 終了欄（空欄）にフォーカスが入ると、開始欄の値がそこに入る。
{
  const start = getEl("mkStart"); start.value = "09:00";
  const end = getEl("mkEnd"); end.value = "";
  dispatchFocusin(end);
  ok("focusing an empty End field defaults it to Start's value", end.value === "09:00");
}

// 2) 既に終了欄に値がある場合は、フォーカスしても上書きしない。
{
  const start = getEl("mkStart"); start.value = "09:00";
  const end = getEl("mkEnd"); end.value = "14:00";
  dispatchFocusin(end);
  ok("focusing an already-set End field doesn't overwrite it", end.value === "14:00");
}

// 3) 開始欄も空欄なら、終了欄にフォーカスしても何も起きない（例外も無い）。
{
  let threw = false;
  try{
    const start = getEl("oeStart"); start.value = "";
    const end = getEl("oeEnd"); end.value = "";
    dispatchFocusin(end);
    ok("End stays empty when Start is also empty", end.value === "");
  }catch(e){ threw = true; }
  ok("focusing End with an empty Start doesn't throw", !threw);
}

// 4) 終了欄自身の+/-ボタン（time-step）を、開始側のイベントを一切経由
//    せずに直接押しても、対になる開始欄に値があればそれを基準に動く
//    （以前は終了欄が空欄だと何も起きなかった壊れた挙動）。
{
  const start = getEl("qrStart"); start.value = "13:00";
  const end = getEl("qrEnd"); end.value = "";
  const endSign = getEl("qrEndSign"); endSign.dataset.sign = "1"; endSign.textContent = "+";
  dispatchClick("time-step", { id:"qrEnd", v:"30" });
  ok("pressing End's own +30 button, with no prior Start event, still bases off Start (13:00 -> 13:30)", end.value === "13:30");
}

// 5) 開始欄の"input"イベント（"change"だけでなく）でも、空欄の終了欄に
//    既定値が伝わる。
{
  const start = getEl("aoStart"); start.value = "08:00";
  const end = getEl("aoEnd"); end.value = "";
  dispatchInput(start);
  ok("an 'input' event on Start (not just 'change') also defaults an empty End", end.value === "08:00");
}

console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAILURES`);
process.exit(fail ? 1 : 0);
