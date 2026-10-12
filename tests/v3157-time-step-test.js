const fs = require("fs");
const vm = require("vm");
const path = require("path");

const src = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");

let fail = 0;
function ok(name, cond){
  if(cond){ console.log("PASS", name); } else { console.log("FAIL", name); fail++; }
}

// classList/attributeとも本物の状態を追跡する簡易実装。
function mkEl(id){
  const classes = new Set();
  const attrs = new Map();
  let html = "";
  const el = {
    id, value:"", textContent:"", hidden:false,
    dataset:{}, style:{}, children:[],
    classList:{
      add(c){ classes.add(c); }, remove(c){ classes.delete(c); },
      toggle(c, force){ const on = force!==undefined ? force : !classes.has(c); if(on) classes.add(c); else classes.delete(c); return on; },
      contains(c){ return classes.has(c); },
    },
    setAttribute(k,v){ attrs.set(k, String(v)); },
    removeAttribute(k){ attrs.delete(k); },
    getAttribute(k){ return attrs.has(k) ? attrs.get(k) : null; },
    addEventListener(){}, appendChild(){}, querySelectorAll(){return [];},
    closest(){return null;}, focus(){}, click(){},
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

// toggle-time-stepボタンのquerySelectorAll('[data-act="toggle-time-step"]')を
// 模倣するための簡易レジストリ。
const toggleButtons = [];
function mkToggleBtn(){
  const b = mkEl();
  b.dataset = { act: "toggle-time-step" };
  toggleButtons.push(b);
  return b;
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
    querySelectorAll(sel){
      if(sel === '[data-act="toggle-time-step"]') return toggleButtons;
      return [];
    },
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
vm.runInContext(`globalThis.__t = { get db(){ return db; }, set db(v){ db=v; }, settings, timeStepAttr, timeStepToggleBtn };`, sandbox);
const T = sandbox.__t;

function dispatchClick(dataAct, extra){
  const t = mkEl();
  t.dataset = Object.assign({ act: dataAct }, extra||{});
  t.closest = function(sel){ if(sel === "[data-act]") return t; return null; };
  const evt = { target: t, preventDefault(){}, stopPropagation(){} };
  clickListeners.forEach(fn=>fn(evt));
  return t;
}

T.db = { settings: {} };

// v3.157-1: デフォルトは5分刻みオフ——timeStepAttr()は空文字、
// timeStepToggleBtn()は"on"クラス無し。
ok("timeStepAttr is empty by default", T.timeStepAttr() === "");
ok("toggle button has no on class by default", !T.timeStepToggleBtn().includes(' on"'));

// v3.157-2: トグルを押すと設定が反転し、既存の時間欄(存在するもの)の
// step属性が300になる。存在しない欄(IDがDOMに無いもの)はスキップされて
// 例外にならない。
{
  const oeStart = getEl("oeStart");
  const oeEnd = getEl("oeEnd");
  const btn = mkToggleBtn();

  dispatchClick("toggle-time-step");
  ok("settings().timeStep5 becomes true", T.settings().timeStep5 === true);
  ok("existing time input gets step=300", oeStart.getAttribute("step") === "300");
  ok("the other existing time input also gets step=300", oeEnd.getAttribute("step") === "300");
  ok("the toggle button(s) found via querySelectorAll get the on class", btn.classList.contains("on"));
  ok("timeStepAttr() now returns the step attribute string", T.timeStepAttr() === ' step="300"');
}

// v3.157-3: もう一度押すと元(1分刻み=属性なし)に戻る
{
  const oeStart = getEl("oeStart");
  dispatchClick("toggle-time-step");
  ok("settings().timeStep5 becomes false again", T.settings().timeStep5 === false);
  ok("step attribute is removed again", oeStart.getAttribute("step") === null);
  ok("toggle button(s) lose the on class", !toggleButtons.some(b=>b.classList.contains("on")));
}

console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAILURES`);
process.exit(fail ? 1 : 0);
