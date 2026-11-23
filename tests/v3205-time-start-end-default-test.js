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

function dispatchChange(el){
  const evt = { target: el };
  changeListeners.forEach(fn=>fn(evt));
}

// v3.205: 「開始を設定したら、終了を設定するとき開始時間がデフォルトで
// そこから変更できるように」との指示。開始〜終了の時刻ペア（timeRow()由来の
// "...Start"/"...End"）で、終了欄が空欄のうちは開始欄を動かすと終了欄にも
// 同じ値が入り、既にある終了欄の値は上書きしない。

// 1) ネイティブの時刻ピッカーで開始を直接セット(change発火)→終了欄が
//    空欄なら開始時刻がそこに入る。
{
  const start = getEl("mkStart"); start.value = "";
  const end = getEl("mkEnd"); end.value = "";
  start.value = "09:00";
  dispatchChange(start);
  ok("native change on an empty-end Start fills End with the same value", end.value === "09:00");
}

// 2) 既に終了欄に値がある場合は、開始をネイティブに変えても上書きしない。
{
  const start = getEl("mkStart"); start.value = "10:00";
  const end = getEl("mkEnd"); end.value = "11:30";
  dispatchChange(start);
  ok("native change on Start never overwrites an already-set End", end.value === "11:30");
}

// 3) +/-ボタン（time-step）で開始を動かした場合も、終了欄が空欄なら
//    動かした後の開始時刻が終了欄に入る（changeイベントは発火しないため、
//    time-step側でも同じことをしている）。
{
  const start = getEl("oeStart"); start.value = "09:00";
  const startSign = getEl("oeStartSign"); startSign.dataset.sign = "1"; startSign.textContent = "+";
  const end = getEl("oeEnd"); end.value = "";
  dispatchClick("time-step", { id:"oeStart", v:"30" });
  ok("stepping Start (+30) moves Start to 09:30", start.value === "09:30");
  ok("...and defaults the still-empty End to that same stepped value", end.value === "09:30");
}

// 4) time-stepで開始を動かしても、終了欄に既に値があれば上書きしない。
{
  const start = getEl("oeStart"); start.value = "09:30";
  const end = getEl("oeEnd"); end.value = "12:00";
  dispatchClick("time-step", { id:"oeStart", v:"5" });
  ok("stepping Start again does not clobber an already-set End", end.value === "12:00");
}

// 5) 終了欄が開始から既定値をもらった後は、以前は何もできなかった
//    「終了欄の+/-ボタン」が効くようになる（空欄のままだとtime-stepは
//    何もしない実装のため、これが今回直った壊れていた挙動）。
{
  const start = getEl("qrStart"); start.value = "13:00";
  const end = getEl("qrEnd"); end.value = "";
  dispatchChange(start); // End defaults to 13:00
  ok("End defaulted from Start via native change", end.value === "13:00");
  const endSign = getEl("qrEndSign"); endSign.dataset.sign = "1"; endSign.textContent = "+";
  dispatchClick("time-step", { id:"qrEnd", v:"30" });
  ok("End's own +30 button now works, moving from the defaulted 13:00 to 13:30", end.value === "13:30");
}

// 6) Start/Endのペアになっていないidや、valueが空のStartでは何もしない
//    （例外も出ない）。
{
  let threw = false;
  try {
    const lone = getEl("hdTime"); lone.value = "08:00";
    dispatchChange(lone);
    const blankStart = getEl("ttStart"); blankStart.value = "";
    dispatchChange(blankStart);
  } catch(e){ threw = true; }
  ok("change events on non-Start or empty-Start fields don't throw", !threw);
}

console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAILURES`);
process.exit(fail ? 1 : 0);
