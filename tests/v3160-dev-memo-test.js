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
  // v3.161: window.claudeが無い(=このテストsandboxのデフォルト状態、
  // GitHub Pages版相当)ときは、同期できる版を開くリンクが出る。
  ok("shows the 'open the syncable version' link when window.claude is unavailable", html.includes('href="https://claude.ai/artifact/6JXB1Ztzkj5h9rnHmd49rf#devmemo"'));
}

// v3.161: #devmemoハッシュで着地した場合、設定タブ・開発メモのカードが
// 自動で開いた状態で起動する(window.claudeがある側=Artifact版での利用を
// 想定——別のsandboxで、location.hashを読み込み前にセットして確認)。
{
  function mkEl2(id){
    let html = "";
    let focusCalled = false;
    const el = {
      id, value:"", textContent:"", hidden:false, focusCalled,
      dataset:{}, style:{}, children:[],
      classList:{ add(){}, remove(){}, toggle(){}, contains(){return false;} },
      addEventListener(){}, appendChild(){}, querySelectorAll(){return [];},
      closest(){return null;}, focus(){ el.focusCalled = true; }, click(){},
      setAttribute(){}, removeAttribute(){}, getAttribute(){return null;},
      get innerHTML(){ return html; }, set innerHTML(v){ html = v; },
    };
    el.querySelector = () => mkEl2("");
    return el;
  }
  const elStore2 = { main: mkEl2("main"), devMemoArea: mkEl2("devMemoArea") };
  function getEl2(id){ if(!elStore2[id]) elStore2[id] = mkEl2(id); return elStore2[id]; }
  const sandbox2 = {
    console,
    crypto: require("crypto").webcrypto,
    window: {},
    localStorage: { _d:{}, getItem(k){return this._d[k]??null;}, setItem(k,v){this._d[k]=String(v);}, removeItem(k){delete this._d[k];} },
    document: {
      getElementById: getEl2,
      querySelector(){ return mkEl2(""); }, querySelectorAll(){ return []; },
      addEventListener(){}, createElement(){ return mkEl2(""); },
      body: mkEl2("body"), documentElement: mkEl2("html"),
    },
    navigator: { userAgent:"node", onLine:true, serviceWorker:undefined },
    location: { hash: "#devmemo", href: "" },   // ← ここがポイント：読み込み前からハッシュをセット
    setInterval(){ return 0; }, clearInterval(){},
    setTimeout(){ return 0; }, clearTimeout(){},
    requestAnimationFrame(fn){ return 0; },
    matchMedia(){ return { matches:false, addEventListener(){}, addListener(){} }; },
    fetch: undefined, alert(){}, confirm(){ return true; },
    addEventListener(){}, removeEventListener(){},
  };
  sandbox2.window = sandbox2;
  sandbox2.globalThis = sandbox2;
  vm.createContext(sandbox2);
  try{
    vm.runInContext(src, sandbox2, { filename: "app.js" });
  }catch(e){
    console.log("SCRIPT THREW ON LOAD (hash sandbox):", e.message);
    fail++;
  }
  vm.runInContext(`globalThis.__t2 = { state };`, sandbox2);
  const state2 = sandbox2.__t2.state;
  ok("landing with #devmemo switches to the settings tab automatically", state2.tab === "settings");
  ok("landing with #devmemo opens the devmemo card automatically", state2._setOpen.has("devmemo"));
  ok("landing with #devmemo focuses the textarea", elStore2.devMemoArea.focusCalled === true);
}

console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAILURES`);
process.exit(fail ? 1 : 0);
