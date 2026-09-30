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
function getEl(id){ if(!elCache.has(id)) elCache.set(id, mkEl(id)); return elCache.get(id); }

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
  setTimeout(fn, ms){ return 0; },
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

function dispatchClick(act, extra){
  const btn = { dataset: Object.assign({ act }, extra||{}), disabled:false };
  const fakeEvent = { target: { closest: (sel) => sel === "[data-act]" ? btn : null } };
  clickListeners.forEach(fn => fn(fakeEvent));
}

// helper to fill a marker sheet's fields via the mock inputs, then save
function addMarker({ name, start, end }){
  dispatchClick("open-marker");   // opens sheetMarker(null)
  getEl("mkName").value = name;
  getEl("mkStart").value = start;
  getEl("mkEnd").value = end;
  getEl("mkMin").value = "";
  dispatchClick("save-marker");
}

// two back-to-back 予定: A 09:00-10:00, B 10:00-11:00 (B starts exactly where A ends)
addMarker({ name:"予定A", start:"09:00", end:"10:00" });
addMarker({ name:"予定B", start:"10:00", end:"11:00" });
// one isolated 予定: C 14:00-14:30 (nothing adjacent)
addMarker({ name:"予定C", start:"14:00", end:"14:30" });

// force "today" tab + timeline view, then render
dispatchClick("tab", { v:"today" });

const mainHtml = getEl("main").innerHTML;

check("no is-top-half class anywhere in rendered output (class removed/unified)", !mainHtml.includes("is-top-half"));
check("span-bg is-top class is present at least once", mainHtml.includes('span-bg span-bg--marker is-top'));
check("split-shift class is present on at least one tl-blocklabel (title shifted to match band)", mainHtml.includes("tl-blocklabel split-shift"));
check("予定A/B/C titles all present", mainHtml.includes("予定A") && mainHtml.includes("予定B") && mainHtml.includes("予定C"));

// count how many is-top spans vs how many split-shift labels appear — with 3 timed
// markers (A,B,C) all having mins set, all 3 should get both is-top and split-shift
// (this is the core "regardless of adjacency" assertion)
const isTopCount = (mainHtml.match(/span-bg span-bg--marker is-top"/g) || []).length;
const splitShiftCount = (mainHtml.match(/tl-blocklabel split-shift/g) || []).length;
// seed() may add its own sample markers too, so just assert at least our 3 got it
check(`is-top applied to at least our 3 markers (got ${isTopCount})`, isTopCount >= 3);
check(`split-shift applied to at least our 3 marker titles (got ${splitShiftCount})`, splitShiftCount >= 3);
check("is-top count equals split-shift count (every spanned start row shifts its title the same way)", isTopCount === splitShiftCount);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
