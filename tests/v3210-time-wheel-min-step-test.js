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
  const classes = new Set();
  const children = [];
  const el = {
    id, value:"", textContent:"", hidden:false, scrollTop:0, tagName:"DIV", dataset:{}, style:{},
    classList:{
      add(c){ classes.add(c); },
      remove(c){ classes.delete(c); },
      toggle(c, force){
        const want = force !== undefined ? force : !classes.has(c);
        if(want) classes.add(c); else classes.delete(c);
        return want;
      },
      contains(c){ return classes.has(c); },
    },
    addEventListener(){}, appendChild(){}, querySelectorAll(){ return children.slice(); },
    closest(){return null;}, focus(){}, click(){}, blur(){},
    setAttribute(){}, removeAttribute(){}, getAttribute(){return null;},
    get innerHTML(){ return html; }, set innerHTML(v){ html = v; },
    get onscroll(){ return this._onscroll; }, set onscroll(fn){ this._onscroll = fn; },
    __children: children,
  };
  el.querySelector = () => mkEl("");
  return el;
}

const elCache = new Map();
function getEl(id){
  if(!elCache.has(id)) elCache.set(id, mkEl(id));
  return elCache.get(id);
}

// twMinToggle専用: 中に実際の2つのボタン（1分/5分）を持つ、
// querySelectorAllが効くモック。
function mkMinToggle(){
  const btn1 = mkEl(); btn1.dataset = { v: "1" }; btn1.classList.add("on");
  const btn5 = mkEl(); btn5.dataset = { v: "5" };
  const wrap = mkEl("twMinToggle");
  wrap.querySelectorAll = (sel) => sel === ".tw-min-btn" ? [btn1, btn5] : [];
  wrap.__btn1 = btn1; wrap.__btn5 = btn5;
  return wrap;
}
elCache.set("twMinToggle", mkMinToggle());

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
  setTimeout(fn){ fn(); return 0; },
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
vm.runInContext(`globalThis.__t = {
  openTimeWheel, closeTimeWheel, confirmTimeWheel, setTwMinStep, twBuildCol,
  get twTargetId(){ return twTargetId; }, get twMinStep(){ return twMinStep; }, TW_ITEM_H,
};`, sandbox);
const T = sandbox.__t;

function dispatchClick(dataAct, extra){
  const t = mkEl();
  t.dataset = Object.assign({ act: dataAct }, extra||{});
  t.closest = function(sel){ if(sel === "[data-act]") return t; return null; };
  const evt = { target: t, preventDefault(){}, stopPropagation(){} };
  clickListeners.forEach(fn=>fn(evt));
  return t;
}

// v3.210: 「5分単位でスクロールするピッカーを実装し、画面上でどっちに
// するか切り替えることも可能？」との提案を受け、±ボタン（+1/+5/+30）は
// そのまま残した上で、分の列を1分／5分で切り替えるトグルを追加した。

// 1) 既定は1分刻み——これまで通りの0..59、1行ずつのスクロール。
{
  ok("default minute step is 1", T.twMinStep === 1);
}

// 2) 5分刻みに切り替えると、分の列は0,5,10,...,55の12セルになり、
//    直前に選んでいた分に一番近い5分刻みへスナップする。
{
  const start = getEl("mkStart"); start.value = "";
  const end = getEl("mkEnd"); end.value = "13:42";   // 1分刻みで42分
  T.openTimeWheel("mkEnd", "終了");
  const minCol = getEl("twMinCol");
  ok("opens at the exact minute (42) while in 1-minute mode", minCol.scrollTop === 42 * T.TW_ITEM_H);

  T.setTwMinStep(5);
  ok("twMinStep is now 5", T.twMinStep === 5);
  ok("the minute column now has 12 cells (0,5,...,55)", (minCol.innerHTML.match(/data-v="/g)||[]).length === 12);
  ok("42 minutes rounds to the nearest 5-minute mark (40), index 8", minCol.scrollTop === 8 * T.TW_ITEM_H);
}

// 3) 5分刻みのままOKを押すと、5分刻みの時刻がそのまま反映される。
{
  dispatchClick("tw-ok");
  ok("confirming in 5-minute mode writes a 5-minute-aligned value (13:40)", getEl("mkEnd").value === "13:40");
}

// 4) 1分刻みに戻すと、また0..59の60セルに戻る。
{
  const end = getEl("oeEnd"); end.value = "08:00";
  T.openTimeWheel("oeEnd", "終了");
  T.setTwMinStep(1);
  const minCol = getEl("twMinCol");
  ok("switching back to 1-minute mode restores all 60 cells", (minCol.innerHTML.match(/data-v="/g)||[]).length === 60);
  ok("twMinStep is back to 1", T.twMinStep === 1);
  T.closeTimeWheel();
}

// 5) トグルのUIは、dispatch経由(data-act="tw-min-step")でも切り替わり、
//    ボタンの見た目（.on）も追従する。
{
  const end = getEl("qrEnd"); end.value = "";
  const start = getEl("qrStart"); start.value = "09:10";
  T.openTimeWheel("qrEnd", "終了");
  const toggle = getEl("twMinToggle");
  dispatchClick("tw-min-step", { v: "5" });
  ok("dispatching tw-min-step updates twMinStep", T.twMinStep === 5);
  ok("the 5分 button is marked .on", toggle.__btn5.classList.contains("on"));
  ok("the 1分 button is no longer .on", !toggle.__btn1.classList.contains("on"));
  // 次回また1分に戻せることの確認（他のテストへ影響を残さない後片付けも兼ねる）
  dispatchClick("tw-min-step", { v: "1" });
  ok("switching back via dispatch restores 1-minute mode", T.twMinStep === 1);
  T.closeTimeWheel();
}

console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAILURES`);
process.exit(fail ? 1 : 0);
