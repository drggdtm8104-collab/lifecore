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

const seed = sandbox.seed;
if(typeof seed === "function") seed();

function dispatchClick(dataAct, extra){
  const t = mkEl();
  t.dataset = Object.assign({ act: dataAct }, extra||{});
  t.closest = function(sel){ if(sel === "[data-act]") return t; return null; };
  const evt = { target: t, preventDefault(){}, stopPropagation(){} };
  clickListeners.forEach(fn=>fn(evt));
  return t;
}

// v3.215: 「タスク編集の『開始は空欄可』という文言が、終了は必須のように
// 聞こえる。どちらも任意にできるので、それぞれに独立したクリアボタンを
// 用意して。同じ仕組みのところは共通して直して」との指示。
// timeRow()を使う開始〜終了ペアの画面（oe/mk/ao/qr/tp/tt）全てで、
// 開始・終了それぞれに独立した「クリア」ボタン（clear-time-field、
// data-idでどの欄を消すか指定）を持たせ、文言も「どちらも空欄可」に
// 統一した。

{
  // 1. sheetOccEdit（タスクの時間を編集）
  vm.runInContext(`db.tasks=[{id:"t1",name:"タスク",kind:"single"}]; db.occurrences=[{id:"o1",taskId:"t1",date:todayStr(),plannedStart:"09:00",plannedMin:60,status:"planned",note:""}];`, sandbox);
  vm.runInContext(`sheetOccEdit("o1");`, sandbox);
  const src1 = sandbox.sheetOccEdit.toString();
  ok("sheetOccEdit: label says どちらも空欄可 (not 開始は空欄可)",
    src1.includes("どちらも空欄可") && !src1.includes("開始は空欄可"));
  ok("sheetOccEdit: Start row has its own clear button", src1.includes('clearTimeBtn("oeStart")'));
  ok("sheetOccEdit: End row has its own clear button", src1.includes('clearTimeBtn("oeEnd")'));

  const oeStart = getEl("oeStart"); oeStart.value = "09:00";
  const oeEnd = getEl("oeEnd"); oeEnd.value = "10:00";
  dispatchClick("clear-time-field", { id: "oeEnd" });
  ok("oeEnd clear leaves oeStart untouched", oeStart.value === "09:00");
  ok("oeEnd clear clears oeEnd", oeEnd.value === "");
  dispatchClick("clear-time-field", { id: "oeStart" });
  ok("oeStart clear clears oeStart", oeStart.value === "");
}

{
  // 2. sheetMarker（予定を追加／編集）—以前はmk-clear-spanが終了欄しか
  // 消さなかった。今回開始側にも独立したクリアボタンが付く。
  // ただし「予定」は save-marker側で開始時刻が必須（空欄だと保存できず
  // トーストで警告される）ため、oe/ao/qr/ttとは違い「どちらも空欄可」
  // ではない——文言はその制約を正しく反映したものにする。
  vm.runInContext(`sheetMarker(null);`, sandbox);
  const src2 = sandbox.sheetMarker.toString();
  ok("sheetMarker: label correctly says only 終了 is optional (start is required)",
    src2.includes("終了のみ空欄可") && src2.includes("開始時刻が必須") && !src2.includes("どちらも空欄可"));
  ok("sheetMarker: Start row has its own clear button", src2.includes('clearTimeBtn("mkStart")'));
  ok("sheetMarker: End row has its own clear button", src2.includes('clearTimeBtn("mkEnd")'));

  const mkStart = getEl("mkStart"); mkStart.value = "08:00";
  const mkEnd = getEl("mkEnd"); mkEnd.value = "09:00";
  dispatchClick("clear-time-field", { id: "mkStart" });
  ok("mkStart clear clears only mkStart (mkEnd untouched)", mkStart.value === "" && mkEnd.value === "09:00");

  // 開始を消したままでも、クリアボタンが保存時の必須チェックを迂回しない
  // ことを確認する（save-marker側の検証はv3.215で変えていない）。
  vm.runInContext(`db.occurrences = [];`, sandbox);
  getEl("mkName").value = "テスト";
  dispatchClick("save-marker", {});
  const occCountAfter = vm.runInContext(`db.occurrences.length`, sandbox);
  ok("saving a marker with a cleared (empty) Start is still blocked", occCountAfter === 0);
  ok("the required-start toast is shown", getEl("toast").textContent === "開始時刻を入れてください");
}

{
  // 3. sheetAddOcc（ToDoリストに追加）
  vm.runInContext(`db.tasks=[{id:"t1",name:"タスク",kind:"single"}];`, sandbox);
  vm.runInContext(`sheetAddOcc("t1");`, sandbox);
  const src3 = sandbox.sheetAddOcc.toString();
  ok("sheetAddOcc: label says どちらも空欄可", src3.includes("どちらも空欄可"));
  ok("sheetAddOcc: Start row has its own clear button", src3.includes('clearTimeBtn("aoStart")'));
  ok("sheetAddOcc: End row has its own clear button", src3.includes('clearTimeBtn("aoEnd")'));
}

{
  // 4. sheetQuickRun（直接実行）
  vm.runInContext(`sheetQuickRun("t1");`, sandbox);
  const src4 = sandbox.sheetQuickRun.toString();
  ok("sheetQuickRun: label says どちらも空欄可", src4.includes("どちらも空欄可"));
  ok("sheetQuickRun: Start row has its own clear button", src4.includes('clearTimeBtn("qrStart")'));
  ok("sheetQuickRun: End row has its own clear button", src4.includes('clearTimeBtn("qrEnd")'));
}

{
  // 5. sheetTplPlanTime（テンプレ: 予定を追加）—以前はtp-clear-spanが
  // 終了欄しか消さなかった。mkと同じ「予定」なので開始時刻は必須
  // （tpl-add-row側で空欄なら保存をブロックする）——文言もmkと同様。
  const src5 = sandbox.sheetTplPlanTime.toString();
  ok("sheetTplPlanTime: label correctly says only 終了 is optional (start is required)",
    src5.includes("終了のみ空欄可") && src5.includes("開始時刻が必須") && !src5.includes("どちらも空欄可"));
  ok("sheetTplPlanTime: Start row has its own clear button", src5.includes('clearTimeBtn("tpStart")'));
  ok("sheetTplPlanTime: End row has its own clear button", src5.includes('clearTimeBtn("tpEnd")'));
}

{
  // 6. sheetTplTaskTime（テンプレ: タスクを配置）
  const src6 = sandbox.sheetTplTaskTime.toString();
  ok("sheetTplTaskTime: label says どちらも空欄可", src6.includes("どちらも空欄可"));
  ok("sheetTplTaskTime: Start row has its own clear button", src6.includes('clearTimeBtn("ttStart")'));
  ok("sheetTplTaskTime: End row has its own clear button", src6.includes('clearTimeBtn("ttEnd")'));
}

// 旧・画面ごとの個別クリアアクションが残っていないこと（統合し忘れが無いか）
const fullSrc = src;
["oe-clear-span","mk-clear-span","ao-clear-time","qr-clear-span","tp-clear-span","tt-clear-time"].forEach(act=>{
  ok(`old per-sheet action "${act}" no longer exists`, !fullSrc.includes(`case "${act}"`));
});

console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAILURES`);
process.exit(fail ? 1 : 0);
