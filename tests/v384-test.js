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

// --- 1. sheetOccEdit: クリア button + full time clear ---
const srcOccEdit = sandbox.sheetOccEdit.toString();
check("sheetOccEdit: button now labeled クリア (not 終了・所要をなしにする)", srcOccEdit.includes(">クリア<") && !srcOccEdit.includes("終了・所要をなしにする"));

// dispatch oe-clear-span with all 3 fields filled -> should clear all 3
const oeStart = getEl("oeStart"); oeStart.value = "09:00";
const oeEnd = getEl("oeEnd"); oeEnd.value = "10:00";
const oeMin = getEl("oeMin"); oeMin.value = "60";
const btn1 = { dataset:{ act:"oe-clear-span" }, disabled:false };
const fakeEvent1 = { target: { closest: (sel) => sel === "[data-act]" ? btn1 : null } };
clickListeners.forEach(fn => fn(fakeEvent1));
check("oe-clear-span clears oeStart", oeStart.value === "");
check("oe-clear-span clears oeEnd", oeEnd.value === "");
check("oe-clear-span clears oeMin", oeMin.value === "");

// --- 2. cardHTML: editBtn moved to card-head, before statusHTML, only for listView ---
const srcCardHTML = sandbox.cardHTML.toString();
const headIdx = srcCardHTML.indexOf("card-head");
const editIdx = srcCardHTML.indexOf("edit-occ");
const statusIdx = srcCardHTML.indexOf("statusHTML}");
// crude structural check: editBtn constant references edit-occ, and appears in the head template before statusHTML placeholder
check("cardHTML: edit-occ button defined", editIdx !== -1);
const headTemplateIdx = srcCardHTML.indexOf("card-head\">");
const editInHeadIdx = srcCardHTML.indexOf("listView ? editBtn", headTemplateIdx);
check("cardHTML: editBtn placed in card-head (listView-gated)", editInHeadIdx !== -1 && editInHeadIdx > headTemplateIdx);
const cardMetaIdx = srcCardHTML.indexOf("card-meta\">");
check("cardHTML: editBtn no longer duplicated inside card-meta", srcCardHTML.indexOf("${editBtn}", cardMetaIdx) === -1 || srcCardHTML.indexOf("${editBtn}", cardMetaIdx) === -1);

// --- 3. sheetMarker: 備考 textarea + save handling ---
const srcMarker = sandbox.sheetMarker.toString();
check("sheetMarker: has 備考 textarea (mkNote)", srcMarker.includes("mkNote") && srcMarker.includes("備考（任意）"));

// --- 4. timeline note rendering: mk-note div present in renderToday source ---
const srcRenderToday = sandbox.renderToday.toString();
check("renderToday: mk-note rendering present", srcRenderToday.includes("mk-note") && srcRenderToday.includes("b.note"));
check("renderToday: planRows carries note field", srcRenderToday.includes("note:o.note||\"\""));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
