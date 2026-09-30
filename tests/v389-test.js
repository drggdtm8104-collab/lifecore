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
let tabbarReturnsNull = false;
function getEl(id){
  if(id === "tabbar" && tabbarReturnsNull) return null;
  if(!elCache.has(id)) elCache.set(id, mkEl(id));
  return elCache.get(id);
}

const sandbox = {
  console,
  crypto: require("crypto").webcrypto,
  window: {},
  localStorage: {
    _d: {},
    getItem(k){ return Object.prototype.hasOwnProperty.call(this._d, k) ? this._d[k] : null; },
    setItem(k,v){ this._d[k]=String(v); },
    removeItem(k){ delete this._d[k]; },
  },
  document: {
    getElementById: getEl,
    querySelector(){ return mkEl(""); },
    querySelectorAll(){ return []; },
    addEventListener(evt, fn){},
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
sandbox.localStorage._d["lifecore.v1"] = JSON.stringify({
  version:1, meta:{savedAt:"2026-09-20T00:00:00.000Z"}, settings:{showOutlook:true},
  templates:[], tasks:[], notes:[], occurrences:[], dayMeta:{},
});

vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: "app.js" });

let pass = 0, fail = 0;
function check(name, cond){
  if(cond){ pass++; console.log("PASS:", name); }
  else { fail++; console.log("FAIL:", name); }
}

// Simulate the reported scenario: document.getElementById("tabbar") returns null
// during a render() call (e.g. renderTabbar()'s own DOM lookup fails for whatever reason).
tabbarReturnsNull = true;
let threw = false;
try{
  sandbox.render();
}catch(e){
  threw = true;
  console.log("render() threw:", e.message);
}
check("render() does not throw even when #tabbar lookup returns null", !threw);

const mainEl = getEl("main");
check("main content still rendered despite tabbar lookup failing", mainEl.innerHTML.length > 0);

const fabEl = getEl("fab");
check("FAB visibility logic still ran (fab.hidden reflects today-tab visibility)", fabEl.hidden === false);

// Now let tabbar resolve normally and confirm it renders correctly afterward
tabbarReturnsNull = false;
sandbox.render();
const tabbarEl = getEl("tabbar");
check("once #tabbar is available again, it renders normally on next render()", tabbarEl.innerHTML.includes("data-act=\"tab\""));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
