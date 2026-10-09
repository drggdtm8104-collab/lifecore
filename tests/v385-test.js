const fs = require("fs");
const vm = require("vm");
const path = require("path");

const appPath = path.join(__dirname, "app.js");
let src = fs.readFileSync(appPath, "utf8");

function mkEl(id){
  const el = {
    id, value:"", textContent:"", innerHTML:"", dataset:{}, style:{}, hidden:false,
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
  navigator: { userAgent: "node" },
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
vm.runInContext(src, sandbox, { filename: "app.js" });

const seed = sandbox.seed;
if(typeof seed === "function") seed();

let pass = 0, fail = 0;
function check(name, cond){
  if(cond){ pass++; console.log("PASS:", name); }
  else { fail++; console.log("FAIL:", name); }
}

const srcCardHTML = sandbox.cardHTML.toString();
// v3.133: 「未達成」ボタン(unmetBtn)がeditBtnとstatusHTMLの間に追加されたため、
// この行のリテラルも更新。card-head-actionsが1つのspanにまとめる構造自体は
// 変わっていない（v3.85の不具合修正はそのまま維持）。
check("cardHTML wraps editBtn+unmetBtn+statusHTML in one card-head-actions span", srcCardHTML.includes('<span class="card-head-actions">${listView ? editBtn + unmetBtn : ""}${statusHTML}</span>'));
check("cardHTML title span has no separate editBtn/statusHTML siblings before wrapper", !srcCardHTML.includes('${listView ? editBtn + unmetBtn : ""}\n      ${statusHTML}'));

// simulate long title: verify occName truncation is CSS-driven, not JS-truncated
// (title text itself isn't cut in HTML; ellipsis is purely CSS: white-space:nowrap + text-overflow:ellipsis)
// v3.118世代のこのセッションで確立したextract.js（<script>のみを抜き出す）に
// 合わせて、CSSの検証は app.js ではなく実際の index.html（<style>を含む）を
// 直接読んで行うよう修正した——app.jsにはそもそもCSSが含まれないため、
// このチェックは常に失敗していた（アプリ側のCSS自体は変わっていない）。
const htmlSrc = fs.readFileSync("C:\\Users\\hirom\\Claude\\LifeCore\\app\\index.html", "utf8");
check(".card-title CSS uses text-overflow:ellipsis + white-space:nowrap + flex:1;min-width:0",
  /\.card-title\{[^}]*flex:1[^}]*min-width:0[^}]*white-space:nowrap[^}]*overflow:hidden[^}]*text-overflow:ellipsis/.test(htmlSrc.replace(/\s+/g,"")));
check(".card-head-actions CSS has margin-left:auto and flex:none",
  /\.card-head-actions\{margin-left:auto;flex:none/.test(htmlSrc.replace(/\s+/g,"")));
check(".card-status no longer has its own margin-left:auto",
  !/\.card-status\{margin-left:auto/.test(htmlSrc.replace(/\s+/g,"")));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
