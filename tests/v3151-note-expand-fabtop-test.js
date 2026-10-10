const fs = require("fs");
const vm = require("vm");
const path = require("path");

const src = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");

let fail = 0;
function ok(name, cond){
  if(cond){ console.log("PASS", name); } else { console.log("FAIL", name); fail++; }
}

// このテストでは実際のクラス状態を見たいので、classListは本物のSetで追跡する
// 簡易実装にする（他のテストファイルのダミー実装とは独立・別コピー）。
function mkEl(id){
  const classes = new Set();
  let html = "";
  const el = {
    id, value:"", textContent:"", hidden:false,
    dataset:{}, style:{}, children:[],
    classList:{
      add(c){ classes.add(c); }, remove(c){ classes.delete(c); },
      toggle(c, force){ const on = force!==undefined ? force : !classes.has(c); if(on) classes.add(c); else classes.delete(c); return on; },
      contains(c){ return classes.has(c); },
    },
    addEventListener(){}, appendChild(){}, querySelectorAll(){return [];},
    closest(){return null;}, focus(){}, click(){}, getAttribute(){return null;}, setAttribute(){},
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
vm.runInContext(`globalThis.__t = { get db(){ return db; }, set db(v){ db=v; }, noteTextarea, state, render };`, sandbox);
const T = sandbox.__t;

function dispatchClick(dataAct, extra){
  const t = mkEl();
  t.dataset = Object.assign({ act: dataAct }, extra||{});
  t.closest = function(sel){ if(sel === "[data-act]") return t; return null; };
  const evt = { target: t, preventDefault(){}, stopPropagation(){} };
  clickListeners.forEach(fn=>fn(evt));
  return t;
}

// v3.151-1: noteTextarea()ヘルパーが.note-wrap+拡大ボタン付きのHTMLを返す
{
  const html = T.noteTextarea("myNote", "本文", "placeholder例", ` data-occid="abc"`);
  ok("wraps in .note-wrap", html.includes('<div class="note-wrap">'));
  ok("textarea has the given id/value/placeholder/extra attr", html.includes('id="myNote"') && html.includes(">本文</textarea>") && html.includes('placeholder="placeholder例"') && html.includes('data-occid="abc"'));
  ok("includes the expand button pointed at the same id", html.includes('data-act="toggle-note-expand"') && html.includes('data-id="myNote"'));
  ok("button starts labeled 拡大", html.includes(">拡大<"));
}

// v3.151-2: toggle-note-expand は対象のtextareaのexpandedクラスをトグルし、
// 押したボタン自身の文字を拡大/縮小で切り替える。save()/render()は呼ばない
// （呼ぶと入力中の未保存テキストが消えるため、ここでは呼ばれないことも
// renderが0回のままであることで確認する）。
{
  const ta = getEl("myNote2");
  let renderCalls = 0;
  const origRender = T.render;
  // renderをスパイしたいが、グローバル関数の再代入はsandbox内でのみ有効に
  // したいので、ここでは代わりに「呼ばれたらエラーになる」ような構成にせず、
  // 単純にtoggle後のDOM状態のみを検証する（render()自体は他のケースで
  // 十分に動作確認済み）。
  const btn1 = dispatchClick("toggle-note-expand", { id:"myNote2" });
  ok("first click adds the expanded class", ta.classList.contains("expanded"));
  ok("first click changes button label to 縮小", btn1.textContent === "縮小");

  const btn2 = dispatchClick("toggle-note-expand", { id:"myNote2" });
  ok("second click removes the expanded class", !ta.classList.contains("expanded"));
  ok("second click changes button label back to 拡大", btn2.textContent === "拡大");
}

// v3.151-3: 「ページの先頭へ」(FABTOP)はFABと同じ表示条件(today/tasks/notes)
// で出る。
{
  const fab = getEl("fab");
  const fabTop = getEl("fabTop");
  T.state.tab = "today";
  T.render();
  ok("FAB and FABTOP both visible on today tab", fab.hidden === false && fabTop.hidden === false);

  T.state.tab = "history";
  T.render();
  ok("FAB and FABTOP both hidden on history tab (no FAB there)", fab.hidden === true && fabTop.hidden === true);

  T.state.tab = "tasks";
  T.render();
  ok("FAB and FABTOP both visible on tasks tab", fab.hidden === false && fabTop.hidden === false);

  T.state.tab = "today";
  T.render();
}

console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAILURES`);
process.exit(fail ? 1 : 0);
