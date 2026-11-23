const fs = require("fs");
const vm = require("vm");
const path = require("path");

const html = fs.readFileSync("C:\\Users\\hirom\\Claude\\LifeCore\\app\\index.html", "utf8");
const src = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");

let fail = 0;
function ok(name, cond){
  if(cond){ console.log("PASS", name); } else { console.log("FAIL", name); fail++; }
}

// v3.209-a: 「予定追加画面の段階での枠やボタンのサイズ配置などは以前と
// 同じにして」との指摘。.ts-input単体（クラス1つ、詳細度0,1,0）だと、
// generic form controls側のinput[type="text"]（属性セレクタ込みで0,1,1）
// の方が詳細度で勝ってしまい、width:100%/padding:8px 10pxに上書きされて
// 時刻欄の幅が崩れ、横並びのボタンが次の行に折り返されていた。
// .time-stepper-row .ts-inputまで詳細度を上げて、元の
// .time-stepper-row input[type="time"]と同じ強さに戻したことを確認する。
{
  const rule = html.match(/\.time-stepper-row \.ts-input\{([^}]*)\}/);
  ok(".time-stepper-row .ts-input rule exists (scoped, not bare .ts-input)", !!rule);
  const body = rule ? rule[1] : "";
  ok("...and still fixes the width back to 82px", /width:82px/.test(body));
  ok("...and still fixes the padding back to 0 6px", /padding:0 6px/.test(body));
  // 詳細度の罠そのものに戻っていないか: bare "  .ts-input{" という
  // （.time-stepper-rowを伴わない）定義が無いことも確認する。
  ok("no bare, under-specific '.ts-input{' rule exists anymore", !/[^-.]\.ts-input\{/.test(html.replace(/\.time-stepper-row \.ts-input\{/g, "")));
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
  openTimeWheel, closeTimeWheel, confirmTimeWheel, twInitialValue, twBuildCol,
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

// v3.209-b: 「閉じるではなく、OKとキャンセルを用意して、OKはその時刻で
// 入力、キャンセルは設定せずに戻る」との指示。スクロール中は値を書き
// 込まず、OKを押した時だけ対象欄に反映し、キャンセルなら何も変えずに
// 閉じる。

// 1) 開始が設定済み・終了が空欄の状態で終了欄を開き、ホイールをスクロール
//    しても（＝確定前）、対象欄はまだ書き換わらない。
{
  const start = getEl("mkStart"); start.value = "11:00";
  const end = getEl("mkEnd"); end.value = "";
  T.openTimeWheel("mkEnd", "終了");
  const hourCol = getEl("twHourCol"), minCol = getEl("twMinCol");
  // ユーザーが13:45までスクロールしたことを模す
  hourCol.scrollTop = 13 * T.TW_ITEM_H; hourCol.onscroll();
  minCol.scrollTop = 45 * T.TW_ITEM_H; minCol.onscroll();
  ok("scrolling the wheel does NOT write into the target field before OK", end.value === "");
}

// 2) OKを押すと、その時点でスクロールして選んでいた時刻が反映される。
{
  dispatchClick("tw-ok");
  const end = getEl("mkEnd");
  ok("pressing OK commits the currently-scrolled time into the target field", end.value === "13:45");
  ok("pressing OK also closes the overlay", !getEl("timeWheelWrap").classList.contains("open"));
  ok("pressing OK clears the tracked target", T.twTargetId === null);
}

// 3) キャンセルを押すと、スクロールしていても対象欄は変わらず、
//    開く前の値のまま戻る。
{
  const start = getEl("oeStart"); start.value = "09:00";
  const end = getEl("oeEnd"); end.value = "20:00";   // すでに設定済みの終了時刻
  T.openTimeWheel("oeEnd", "終了");
  const hourCol = getEl("twHourCol"), minCol = getEl("twMinCol");
  hourCol.scrollTop = 5 * T.TW_ITEM_H; hourCol.onscroll();
  minCol.scrollTop = 10 * T.TW_ITEM_H; minCol.onscroll();
  dispatchClick("tw-cancel");
  ok("pressing Cancel leaves the target field exactly as it was before opening (20:00)", end.value === "20:00");
  ok("pressing Cancel closes the overlay", !getEl("timeWheelWrap").classList.contains("open"));
}

// 4) 背景タップもキャンセルと同じ扱い（data-act="tw-cancel"）であること。
{
  const rule = fs.readFileSync("C:\\Users\\hirom\\Claude\\LifeCore\\app\\index.html", "utf8");
  ok('tapping the dimmed background cancels rather than confirms', /class="time-wheel-bg" data-act="tw-cancel"/.test(rule));
}

// 5) 見出しに「閉じる」ボタンはもう無く、OK/キャンセルの2ボタンに
//    なっている。
{
  const rule = fs.readFileSync("C:\\Users\\hirom\\Claude\\LifeCore\\app\\index.html", "utf8");
  ok('no "閉じる" button remains inside the time-wheel popup', !/timeWheelPop[\s\S]{0,400}?閉じる/.test(rule));
  ok('an OK button (data-act="tw-ok") exists', /data-act="tw-ok"[^>]*>OK</.test(rule));
  ok('a キャンセル button (data-act="tw-cancel") exists inside the popup actions', /data-act="tw-cancel">キャンセル</.test(rule));
}

console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAILURES`);
process.exit(fail ? 1 : 0);
