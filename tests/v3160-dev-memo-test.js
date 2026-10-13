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

const elStore = { main: mkEl("main") };
function getEl(id){
  if(!elStore[id]) elStore[id] = mkEl(id);
  return elStore[id];
}

const clickListeners = [];
const inputListeners = [];
const focusoutListeners = [];
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
      else if(evt==="input") inputListeners.push(fn);
      else if(evt==="focusout") focusoutListeners.push(fn);
    },
    createElement(){ return mkEl(""); },
    body: mkEl("body"),
    documentElement: mkEl("html"),
  },
  navigator: { userAgent: "node", onLine: true, serviceWorker: undefined },
  location: { hash: "", href: "" },
  setInterval(){ return 0; },
  clearInterval(){},
  setTimeout(){ return 0; },
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
vm.runInContext(`globalThis.__t = { get db(){ return db; }, set db(v){ db=v; }, settings, renderSettings };`, sandbox);
const T = sandbox.__t;

function dispatchClick(dataAct, extra){
  const t = mkEl();
  t.dataset = Object.assign({ act: dataAct }, extra||{});
  t.closest = function(sel){ if(sel === "[data-act]") return t; return null; };
  const evt = { target: t, preventDefault(){}, stopPropagation(){} };
  clickListeners.forEach(fn=>fn(evt));
}
function dispatchInput(id, value){
  const t = getEl(id);
  t.value = value;
  inputListeners.forEach(fn=>fn({ target: t }));
}

T.db = { settings: {}, templates: [], tasks: [], occurrences: [], dayMeta: {}, notes: [], remarks: [], meta: {} };

// v3.160-1: 開発メモは他のメモ(db.notes)・覚え書き(db.remarks)とは別の
// settings().devMemoという単独フィールド。
ok("devMemo starts empty/undefined", !T.settings().devMemo);

// v3.160-2: devMemoAreaへの入力で、即座にsettings().devMemoに反映される
// （debounceされるのはsave()の呼び出しだけで、モデル自体の更新は同期的）。
dispatchInput("devMemoArea", "次はXXXを直して");
ok("typing into devMemoArea updates settings().devMemo immediately", T.settings().devMemo === "次はXXXを直して");

// v3.160-3: 「クリア」ボタンでsettings().devMemoが空になる
dispatchClick("clear-dev-memo");
ok("clear-dev-memo empties settings().devMemo", T.settings().devMemo === "");

// v3.160-4: 設定画面のレンダリングに、devMemoAreaとクリアボタンが
// 正しく出る（他のメモ一覧とは別の専用カードとして）。
{
  T.settings().devMemo = "テスト用の指示メモ";
  dispatchClick("toggle-set", { v:"devmemo" });   // カードを開く（設定カードはデフォルト折りたたみ）
  T.renderSettings();
  const html = elStore.main.innerHTML;
  ok("renders a textarea with id devMemoArea containing the current value", html.includes('id="devMemoArea"') && html.includes(">テスト用の指示メモ<"));
  ok("renders a クリア button pointed at clear-dev-memo", html.includes('data-act="clear-dev-memo"') && html.includes(">クリア<"));
}

console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAILURES`);
process.exit(fail ? 1 : 0);
