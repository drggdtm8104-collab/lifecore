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
vm.runInContext(`globalThis.__t = { get db(){ return db; }, set db(v){ db=v; }, timeRow, todayStr };`, sandbox);
const T = sandbox.__t;
const today = T.todayStr();

function dispatchClick(dataAct, extra){
  const t = mkEl();
  t.dataset = Object.assign({ act: dataAct }, extra||{});
  t.closest = function(sel){ if(sel === "[data-act]") return t; return null; };
  const evt = { target: t, preventDefault(){}, stopPropagation(){} };
  clickListeners.forEach(fn=>fn(evt));
  return t;
}

// v3.158-1: timeRow()が開始/終了それぞれ用に、ラベル+(-5)(-1)[入力](+1)(+5)を
// 正しいdata-idで出す。
{
  const html = T.timeRow("開始", "oeStart", "09:00");
  ok("has the label", html.includes(">開始<"));
  ok("has the time input with id/value", html.includes('id="oeStart"') && html.includes('value="09:00"'));
  ok("has all four stepper buttons pointed at the same id",
    ['-5','-1','1','5'].every(d => html.includes(`data-act="time-step" data-id="oeStart" data-v="${d}"`)));
}

// v3.158-2: time-stepクリックで指定分だけ時刻がずれる（通常のケース）。
{
  const inp = getEl("oeStart");
  inp.value = "09:00";
  dispatchClick("time-step", { id:"oeStart", v:"5" });
  ok("+5 moves 09:00 to 09:05", inp.value === "09:05");

  dispatchClick("time-step", { id:"oeStart", v:"-1" });
  ok("-1 moves 09:05 to 09:04", inp.value === "09:04");
}

// v3.170: 分のボタンは分だけを0〜59の中で巡回させ、時は変えない
// （「分の微調整のつもりで時まで繰り上がると紛らわしい」との指示でv3.158
// 当時の24時またぎ折り返し仕様を変更——以前は total%1440 で時までまたいで
// いたが、今は時はそのまま分だけをmod 60する）。
{
  const inp = getEl("oeEnd");
  inp.value = "23:58";
  dispatchClick("time-step", { id:"oeEnd", v:"5" });
  ok("23:58 +5 keeps the hour at 23, only the minute wraps (23:58 -> 23:03)", inp.value === "23:03");

  inp.value = "00:02";
  dispatchClick("time-step", { id:"oeEnd", v:"-5" });
  ok("00:02 -5 keeps the hour at 00, only the minute wraps (00:02 -> 00:57)", inp.value === "00:57");
}

// v3.158-4: 時刻が未入力(空欄)のときはエラーにならず何もしない
{
  const inp = getEl("mkStart");
  inp.value = "";
  let threw = false;
  try { dispatchClick("time-step", { id:"mkStart", v:"5" }); } catch(e) { threw = true; }
  ok("stepping an empty time field doesn't throw", !threw);
  ok("stepping an empty time field leaves it empty", inp.value === "");
}

// v3.158-5: 存在しないidを指定しても例外にならない
{
  let threw = false;
  try { dispatchClick("time-step", { id:"doesNotExist", v:"5" }); } catch(e) { threw = true; }
  ok("stepping a nonexistent field doesn't throw", !threw);
}

console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAILURES`);
process.exit(fail ? 1 : 0);
