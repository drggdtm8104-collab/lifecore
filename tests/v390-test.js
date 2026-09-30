const fs = require("fs");
const vm = require("vm");
const path = require("path");

const appPath = path.join(__dirname, "app.js");
let src = fs.readFileSync(appPath, "utf8");

function mkEl(id){
  const el = {
    id, value:"", textContent:"", innerHTML:"", dataset:{}, style:{}, hidden: id === "toast" ? true : false,
    classList:{ add(){}, remove(){}, contains(){return false;}, toggle(){} },
    addEventListener(){}, appendChild(){}, querySelectorAll(){return [];},
    closest(){return null;}, focus(){}, click(){}, getAttribute(){return null;}, setAttribute(){},
  };
  el.querySelector = () => mkEl("");
  return el;
}
const elCache = new Map();
function getEl(id){
  if(!elCache.has(id)) elCache.set(id, mkEl(id));
  return elCache.get(id);
}

// realistic style object with setProperty, like a real CSSStyleDeclaration
const cssVars = {};
const docElStyle = { setProperty(k,v){ cssVars[k]=v; }, getPropertyValue(k){ return cssVars[k]||""; } };
const documentElement = mkEl("html");
documentElement.style = docElStyle;

const windowListeners = {};
const docListeners = {};
let visualViewportListeners = {};
const sandbox = {
  console,
  crypto: require("crypto").webcrypto,
  window: {},
  localStorage: {
    _d: { "lifecore.v1": JSON.stringify({ version:1, meta:{savedAt:"2026-09-20T00:00:00.000Z"}, settings:{showOutlook:true}, templates:[], tasks:[], notes:[], occurrences:[], dayMeta:{} }) },
    getItem(k){ return Object.prototype.hasOwnProperty.call(this._d, k) ? this._d[k] : null; },
    setItem(k,v){ this._d[k]=String(v); },
    removeItem(k){ delete this._d[k]; },
  },
  document: {
    getElementById: getEl,
    querySelector(){ return mkEl(""); },
    querySelectorAll(){ return []; },
    addEventListener(evt, fn){ (docListeners[evt] = docListeners[evt]||[]).push(fn); },
    createElement(){ return mkEl(""); },
    body: mkEl("body"),
    documentElement,
    visibilityState: "visible",
  },
  navigator: { userAgent: "node" },
  location: { hash: "", href: "" },
  setInterval(){ return 0; },
  clearInterval(){},
  setTimeout(fn, ms){ return 0; },
  clearTimeout(){},
  requestAnimationFrame(fn){ return 0; },
  matchMedia(){ return { matches:false, addEventListener(){}, addListener(){} }; },
  fetch: undefined,
  alert(){},
  confirm(){ return true; },
  addEventListener(evt, fn){ (windowListeners[evt] = windowListeners[evt]||[]).push(fn); },
  removeEventListener(){},
  innerHeight: 800,
  visualViewport: {
    height: 800,
    addEventListener(evt, fn){ (visualViewportListeners[evt] = visualViewportListeners[evt]||[]).push(fn); },
  },
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;

vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: "app.js" });

let pass = 0, fail = 0;
function check(name, cond){
  if(cond){ pass++; console.log("PASS:", name); }
  else { fail++; console.log("FAIL:", name); }
}

// v3.91: --app-h をvisualViewportのJSで再計算する方式はうまくいかず撤去され、
// position:fixed;inset:0 という純粋なCSSだけで画面サイズに追従する方式に
// 置き換わった（app/index.htmlのv3.91コメント参照）。--app-h・
// visualViewportまわりのイベントリスナーは現在のコードに一切存在しないため、
// それらを検証していた元のテストは全項目削除し、代わりに置き換え後の
// CSSアプローチが今も維持されていることだけを確認する軽量なテストにした。
check("app.js no longer references --app-h (the removed JS-recalculation approach)", !src.includes("--app-h"));
check("app.js no longer references visualViewport (removed along with --app-h)", !src.includes("visualViewport"));

const htmlSrc = fs.readFileSync("C:\\Users\\hirom\\Claude\\LifeCore\\app\\index.html", "utf8").replace(/\s+/g,"");
check(".app CSS uses position:fixed;inset:0 (the replacement approach, v3.91〜)", /\.app\{position:fixed;inset:0/.test(htmlSrc));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
