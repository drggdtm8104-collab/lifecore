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
    id, value:"", textContent:"", hidden:false,
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
vm.runInContext(`globalThis.__t = {};`, sandbox);

function dispatchClick(dataAct, extra){
  const t = mkEl();
  t.dataset = Object.assign({ act: dataAct }, extra||{});
  t.closest = function(sel){ if(sel === "[data-act]") return t; return null; };
  const evt = { target: t, preventDefault(){}, stopPropagation(){} };
  clickListeners.forEach(fn=>fn(evt));
  return t;
}

// v3.214: 「スケジュールのタスク編集から進んで時間のプラマイ編集ボタンを
// 押したら勝手に終了も記入されて、クリアで全部消えた」というバグ報告。
// 開始欄の±ボタン（time-step）を押しただけで、空欄の終了欄に開始時刻が
// 書き込まれていた（v3.205の名残り）のが原因。終了欄を一度も操作していない
// のに値が入ってしまい、取り消すには終了クリア（oe-clear-span）で開始も
// 一緒に消すしかなかった。開始欄側からの書き込みを削除し、終了欄は
// 終了欄自身を操作したときだけ開始欄の値を既定値として使う（v3.206、
// tests/v3208-time-wheel-test.jsで検証済み）という元の一方向の挙動に戻す。

{
  const start = getEl("oeStart"); start.value = "09:00";
  const end = getEl("oeEnd"); end.value = "";
  dispatchClick("time-step", { id:"oeStart", v:"5" });
  ok("pressing Start's +5 still moves Start correctly (09:00 -> 09:05)", start.value === "09:05");
  ok("pressing Start's +/- no longer auto-fills an empty End field", end.value === "");
}

{
  // 終了欄に既に値がある場合、以前も上書きしなかったが、念のためそのまま
  // であることも確認する（開始側の変更が終了欄に一切影響しないことの確認）。
  const start = getEl("oeStart"); start.value = "10:00";
  const end = getEl("oeEnd"); end.value = "11:00";
  dispatchClick("time-step", { id:"oeStart", v:"30" });
  ok("Start's +30 doesn't touch an already-set End value", end.value === "11:00");
}

{
  // v3.206で追加された「終了欄自身の±ボタンは、終了欄が空欄なら開始欄の
  // 値を基準にする」挙動は、今回の修正でも変えずに残っていることを確認。
  const start = getEl("mkStart"); start.value = "13:00";
  const end = getEl("mkEnd"); end.value = "";
  dispatchClick("time-step", { id:"mkEnd", v:"30" });
  ok("End's own +30 button still bases off Start when End is empty (13:00 -> 13:30)", end.value === "13:30");
}

console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAILURES`);
process.exit(fail ? 1 : 0);
