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
  const el = {
    id, value:"", textContent:"", hidden:false, scrollTop:0, tagName:"DIV",
    dataset:{}, style:{}, children:[],
    classList:{
      add(c){ classes.add(c); },
      remove(c){ classes.delete(c); },
      toggle(c){ if(classes.has(c)){ classes.delete(c); return false; } classes.add(c); return true; },
      contains(c){ return classes.has(c); },
    },
    addEventListener(){}, appendChild(){}, querySelectorAll(){return [];},
    closest(){return null;}, focus(){}, click(){}, blur(){},
    setAttribute(){}, removeAttribute(){}, getAttribute(){return null;},
    get innerHTML(){ return html; }, set innerHTML(v){ html = v; },
    get onscroll(){ return this._onscroll; }, set onscroll(fn){ this._onscroll = fn; },
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
  setTimeout(fn){ fn(); return 0; },   // v3.208のtwOnScroll debounceは即時実行で十分
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
  timeRow, openTimeWheel, closeTimeWheel, twInitialValue, twBuildCol, twCommit,
  get twTargetId(){ return twTargetId; }, TW_ITEM_H,
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

// v3.208: ネイティブの<input type="time">ピッカーは、空欄のまま開くと
// 実機ブラウザ・機種によって「現在時刻から始まる」挙動を外部のJSから
// 確実に上書きできなかった（v3.205〜v3.207で3回対策しても実機で直らず）。
// ピッカー自体を自前のスクロール式(time-wheel)に置き換え、開く瞬間の
// 初期スクロール位置を直接指定することで、挙動を完全にこちらで制御
// できるようにした。

// 1) timeRow()が出す時刻欄は、ネイティブピッカーを開かせない
//    (type="text"+readonly+inputmode="none") 自前ピッカーのトリガーに
//    変わっている。
{
  const html = T.timeRow("開始", "mkStart", "09:00");
  ok('timeRow() no longer emits type="time" (would reopen the native picker)', !/type="time"/.test(html));
  ok('timeRow()\'s time field is type="text"', /type="text"[^>]*id="mkStart"/.test(html));
  ok("the time field is readonly (no native keyboard/picker)", /readonly/.test(html));
  ok('the time field has inputmode="none" (no on-screen keyboard)', /inputmode="none"/.test(html));
  ok("the time field opens the time-wheel on tap", /data-act="open-time-wheel"/.test(html) && /data-id="mkStart"/.test(html));
  ok("the time field carries its label for the wheel's heading", /data-label="開始"/.test(html));
  ok("value is still rendered the same way as before", /value="09:00"/.test(html));
}

// 2) twInitialValue(): 既に値があればそれを使う。
{
  const start = getEl("mkStart"); start.value = "";
  const end = getEl("mkEnd"); end.value = "14:00";
  ok("twInitialValue returns the field's own value when it already has one", T.twInitialValue("mkEnd") === "14:00");
}

// 3) twInitialValue(): 終了欄(...End)が空欄でも、対になる開始欄
//    (...Start)に値があればそれを初期値にする——これが今回の核心の挙動。
{
  const start = getEl("oeStart"); start.value = "10:30";
  const end = getEl("oeEnd"); end.value = "";
  ok("twInitialValue defaults an empty End field to its paired Start's value", T.twInitialValue("oeEnd") === "10:30");
}

// 4) twInitialValue(): 開始欄も空欄なら、現在時刻（HH:MM形式）になる
//    （例外にならず、何かしらの妥当な時刻文字列を返す）。
{
  const start = getEl("aoStart"); start.value = "";
  const end = getEl("aoEnd"); end.value = "";
  const v = T.twInitialValue("aoEnd");
  ok("twInitialValue falls back to a HH:MM-shaped value when both are empty", /^\d{2}:\d{2}$/.test(v));
}

// 5) twBuildCol(): 0..maxの実セルを作り、初期スクロール位置を
//    「指定した値 × セル高さ」に即座にセットする——アニメーション無しで
//    一発で合わせるのが、ネイティブピッカーのタイミング問題を避ける核心。
{
  const col = getEl("twHourCol");
  T.twBuildCol(col, 23, 9);
  ok("twBuildCol scrolls immediately to the given index (9 hours in)", col.scrollTop === 9 * T.TW_ITEM_H);
  ok("twBuildCol renders a cell for every value 0..max", (col.innerHTML.match(/data-v="/g)||[]).length === 24);

  const col2 = getEl("twMinCol");
  T.twBuildCol(col2, 59, 30);
  ok("twBuildCol works for the minute column too (0..59)", col2.scrollTop === 30 * T.TW_ITEM_H);
  ok("minute column has 60 real cells", (col2.innerHTML.match(/data-v="/g)||[]).length === 60);
}

// 6) openTimeWheel(): 開始が設定済み・終了が空欄の状態で終了欄を開くと、
//    開始時刻の位置からスクロールが始まり、見出しラベルも設定される。
{
  const start = getEl("mkStart"); start.value = "11:00";
  const end = getEl("mkEnd"); end.value = "";
  const wrap = getEl("timeWheelWrap");
  wrap.classList.remove("open");
  T.openTimeWheel("mkEnd", "終了");
  ok("openTimeWheel opens the overlay", wrap.classList.contains("open"));
  ok("openTimeWheel tracks which field it's editing", T.twTargetId === "mkEnd");
  ok("openTimeWheel sets the heading to the given label", getEl("twLabel").textContent === "終了");
  const hourCol = getEl("twHourCol"), minCol = getEl("twMinCol");
  ok("hour wheel starts scrolled to Start's hour (11)", hourCol.scrollTop === 11 * T.TW_ITEM_H);
  ok("minute wheel starts scrolled to Start's minute (00)", minCol.scrollTop === 0 * T.TW_ITEM_H);
  ok("opening the wheel already commits that default into the target field", end.value === "11:00");
}

// 7) closeTimeWheel(): オーバーレイを閉じ、対象を見失わないようにクリアする。
{
  T.closeTimeWheel();
  ok("closeTimeWheel closes the overlay", !getEl("timeWheelWrap").classList.contains("open"));
  ok("closeTimeWheel clears the tracked target", T.twTargetId === null);
}

// 8) クリック経由(data-act)でも同じ関数が正しい引数で呼ばれる。
{
  const start = getEl("qrStart"); start.value = "13:00";
  const end = getEl("qrEnd"); end.value = "";
  dispatchClick("open-time-wheel", { id:"qrEnd", label:"終了" });
  ok("dispatching 'open-time-wheel' opens it for the clicked field", T.twTargetId === "qrEnd");
  ok("...and defaults it from Start via the same path a real tap uses", end.value === "13:00");
  dispatchClick("tw-close");
  ok("dispatching 'tw-close' closes the overlay", !getEl("timeWheelWrap").classList.contains("open"));
}

// 9) 既存の挙動が引き続き保たれていること: 終了欄自身の+/-ボタン
//    （time-step）を、ウィールを一度も開かずに直接押しても、対になる
//    開始欄があればそれを基準に動く（v3.206で直した壊れていた挙動）。
{
  const start = getEl("qrStart"); start.value = "13:00";
  const end = getEl("qrEnd"); end.value = "";
  const endSign = getEl("qrEndSign"); endSign.dataset.sign = "1"; endSign.textContent = "+";
  dispatchClick("time-step", { id:"qrEnd", v:"30" });
  ok("End's own +30 button still bases off Start when End is empty (13:00 -> 13:30)", end.value === "13:30");
}

console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAILURES`);
process.exit(fail ? 1 : 0);
