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

// time-step-signは、押された自分自身(el)のdataset/textContentを直接書き換える
// 実装なので、呼び出すたびに使い捨てのmkEl()を渡すdispatchClick()では、実際に
// 画面に居続ける＜inputId＞Sign要素とは別物を書き換えてしまい、次のtime-step
// から見えない——必ずgetEl(inputId+"Sign")という「永続する同じオブジェクト」
// をクリック対象にする専用ヘルパーを使う。
function clickSignToggle(inputId){
  const t = getEl(inputId + "Sign");
  t.dataset.act = "time-step-sign";
  t.dataset.id = inputId;
  t.closest = function(sel){ if(sel === "[data-act]") return t; return null; };
  const evt = { target: t, preventDefault(){}, stopPropagation(){} };
  clickListeners.forEach(fn=>fn(evt));
  return t;
}

// v3.180-1: timeRow()が開始/終了それぞれ用に、ラベル＋方向トグル(＋)＋
// 移動量ボタン(1/5/30)を正しいdata-idで出す（-5/-1/+1/+5の4ボタンから、
// 「方向トグル1つ＋1/5/30の3つ」の計4ボタンに置き換え）。
{
  const html = T.timeRow("開始", "oeStart", "09:00");
  ok("has the label", html.includes(">開始<"));
  ok("has the time input with id/value", html.includes('id="oeStart"') && html.includes('value="09:00"'));
  ok("has a sign-toggle button defaulting to +", /id="oeStartSign"[^>]*data-sign="1"[^>]*>\+</.test(html));
  ok("has the three magnitude buttons (1/5/30) pointed at the same id",
    ['1','5','30'].every(d => html.includes(`data-act="time-step" data-id="oeStart" data-v="${d}"`)));
  ok("no longer has negative data-v buttons", !html.includes('data-v="-5"') && !html.includes('data-v="-1"'));
}

// v3.180-2: 既定（＋方向）でのtime-stepクリックで指定分だけ時刻が進む。
{
  const inp = getEl("oeStart");
  inp.value = "09:00";
  dispatchClick("time-step", { id:"oeStart", v:"5" });
  ok("+5 moves 09:00 to 09:05", inp.value === "09:05");

  dispatchClick("time-step", { id:"oeStart", v:"1" });
  ok("+1 moves 09:05 to 09:06", inp.value === "09:06");
}

// v3.180-3: 方向トグル(time-step-sign)を押すと＋／－が切り替わり、以後の
// time-stepはその方向で動く。
{
  const signBtn = getEl("oeStartSign");
  signBtn.dataset.sign = "1"; signBtn.textContent = "+";
  clickSignToggle("oeStart");
  ok("tapping the sign toggle flips it to -", signBtn.dataset.sign === "-1");
  ok("the toggle's own label shows − after flipping", signBtn.textContent === "−");

  const inp = getEl("oeStart");
  inp.value = "09:06";
  dispatchClick("time-step", { id:"oeStart", v:"5" });
  ok("with the toggle flipped to -, pressing 5 moves backward (09:06 -> 09:01)", inp.value === "09:01");

  clickSignToggle("oeStart");
  ok("tapping the toggle again flips it back to +", signBtn.dataset.sign === "1");
  ok("the toggle's own label shows + after flipping back", signBtn.textContent === "+");
}

// v3.180-4: 「残業で後ろ倒し」を想定した30分移動。時をまたぐ場合も正しく
// 繰り上がる（以前のv3.170仕様は分だけをmod 60し時を変えなかったが、
// 30分移動は時をまたぐのが前提のため、時もまたぐように変更した）。
{
  const inp = getEl("oeEnd");
  const signBtn = getEl("oeEndSign");
  signBtn.dataset.sign = "1"; signBtn.textContent = "+";

  inp.value = "23:50";
  dispatchClick("time-step", { id:"oeEnd", v:"30" });
  ok("23:50 +30 correctly carries into the next hour (-> 00:20)", inp.value === "00:20");

  inp.value = "00:10";
  clickSignToggle("oeEnd");
  dispatchClick("time-step", { id:"oeEnd", v:"30" });
  ok("00:10 -30 correctly borrows from the previous hour (-> 23:40)", inp.value === "23:40");
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
