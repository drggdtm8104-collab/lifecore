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
vm.runInContext(`globalThis.__t = { get db(){ return db; }, set db(v){ db=v; }, state, settings, renderSettings, renderToday, analyze };`, sandbox);
const T = sandbox.__t;

T.db = { settings: {}, templates: [], tasks: [], occurrences: [], dayMeta: {}, notes: [], remarks: [], meta: {} };

// v3.166-1: 開発メモの指示により「今日の見通し」機能は完全に削除した
// （設定カード・toggle-outlook・今日画面の表示すべて）。
T.state.tab = "settings";
T.renderSettings();
let html = elStore.main.innerHTML;
ok("outlookのsetCardがもう無い", !html.includes('data-v="outlook"'));
ok("今日の見通しという文字列がもう無い", !html.includes("今日の見通し"));

T.state.tab = "today";
T.state.date = "2026-10-13";
T.state.todayView = "list";
let threw = false;
try{ T.renderToday(); }catch(e){ threw = true; console.log("renderToday threw:", e.message); }
ok("見通し削除後もrenderToday()はエラーなく動く", !threw);
html = elStore.main.innerHTML;
ok("今日画面にも見通しカードが出ない", !html.includes('class="outlook"'));

// analyze()自体（傾向タブ用）は残っている — todayOutlook()だけが削除対象だった
threw = false;
try{ T.analyze(); }catch(e){ threw = true; console.log("analyze threw:", e.message); }
ok("analyze()（傾向タブのロジック）は削除されず残っている", !threw);

// v3.166-2: 「読み込み」カードは「バックアップ（読み出し）」という
// バックアップ（書き出し）と対になる名前に変更した。
T.state.tab = "settings";
T.renderSettings();
html = elStore.main.innerHTML;
ok("読み込みカードの新しいタイトルが表示される", html.includes("バックアップ（読み出し）"));
ok("旧タイトル「読み込み」単体はもう見出しとして出ない", !html.includes('>読み込み<'));
ok("import自体のキー（内部識別子）は変えていない", html.includes('data-v="import"'));

// v3.166-3: 開発メモはバックアップ（書き出し）より上に表示する。
const posDevmemo = html.indexOf('data-v="devmemo"');
const posExport = html.indexOf('data-v="export"');
const posImport = html.indexOf('data-v="import"');
ok("開発メモがバックアップ（書き出し）より上にある", posDevmemo !== -1 && posExport !== -1 && posDevmemo < posExport);
ok("バックアップ（書き出し）がバックアップ（読み出し）より上にある", posExport < posImport);

console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAILURES`);
process.exit(fail ? 1 : 0);
