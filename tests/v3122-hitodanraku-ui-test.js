const fs = require("fs");
const vm = require("vm");
const path = require("path");

const src = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");

let fail = 0;
function ok(name, cond){
  if(cond){ console.log("PASS", name); } else { console.log("FAIL", name); fail++; }
}

function mkEl(id){
  const listeners = {};
  const el = {
    id, _html: "", value: "",
    classList: { add(){}, remove(){}, toggle(){}, contains(){return false;} },
    style: {}, dataset: {}, children: [],
    addEventListener(ev, fn){ (listeners[ev] = listeners[ev]||[]).push(fn); },
    querySelector(){ return mkEl(); },
    querySelectorAll(){ return []; },
    closest(){ return null; },
    appendChild(){}, remove(){}, focus(){}, select(){}, click(){},
    get innerHTML(){ return this._html; },
    set innerHTML(v){ this._html = v; },
    getAttribute(){ return null; }, setAttribute(){},
    __listeners: listeners,
  };
  return el;
}

const documentListeners = {};
const elStore = {};
let hdCandRows = [];   // configurable rows returned by querySelectorAll("#hdList .hd-cand")

const fakeDocument = {
  addEventListener(ev, fn){ (documentListeners[ev] = documentListeners[ev]||[]).push(fn); },
  getElementById(id){ if(!elStore[id]) elStore[id] = mkEl(id); return elStore[id]; },
  querySelector(){ return mkEl(); },
  querySelectorAll(sel){ return sel === "#hdList .hd-cand" ? hdCandRows : []; },
  createElement(){ return mkEl(); },
  body: mkEl(), documentElement: mkEl(),
};

const sandbox = {
  document: fakeDocument, window: {}, console,
  localStorage: (function(){
    let store = {};
    return {
      getItem(k){ return store[k]===undefined?null:store[k]; },
      setItem(k,v){ store[k]=String(v); },
      removeItem(k){ delete store[k]; },
    };
  })(),
  navigator: { onLine: true },
  fetch: async ()=>({ ok: true, status: 200, json: async()=>({ok:true}) }),
  setTimeout, clearTimeout, setInterval, clearInterval,
  requestAnimationFrame: (fn)=>setTimeout(fn,0),
  history: { replaceState(){} },
  location: { hash:"", search:"", href:"http://localhost/" },
  alert: ()=>{}, confirm: ()=>true,
  isSecureContext: true,
  visualViewport: undefined,
  performance: { now:()=>Date.now() },
  crypto: require("crypto").webcrypto || {
    randomUUID(){ return require("crypto").randomUUID(); },
    getRandomValues(arr){ return require("crypto").randomFillSync(arr); },
  },
  atob: (s) => Buffer.from(s, "base64").toString("binary"),
  Blob: function(parts, opts){ this.parts = parts; this.type = opts && opts.type; },
  URL: { createObjectURL(){ return "blob:fake"; }, revokeObjectURL(){} },
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.addEventListener = function(){};
sandbox.removeEventListener = function(){};
sandbox.matchMedia = function(){ return { matches:false, addEventListener(){}, removeEventListener(){}, addListener(){}, removeListener(){} }; };

vm.createContext(sandbox);
try{
  vm.runInContext(src, sandbox, { filename: "app.js" });
}catch(e){
  console.log("SCRIPT THREW ON LOAD:", e.message);
  process.exit(1);
}
vm.runInContext(`globalThis.__t = {
  get db(){ return db; }, set db(v){ db=v; },
  get state(){ return state; }, render,
  todayStr,
};`, sandbox);
const T = sandbox.__t;
const TODAY = T.todayStr();

function dispatchClick(dataAct, extra){
  const t = mkEl();
  t.dataset = Object.assign({ act: dataAct }, extra||{});
  t.closest = function(sel){ if(sel === "[data-act]") return t; return null; };
  const handlers = documentListeners["click"] || [];
  const evt = { target: t, preventDefault(){}, stopPropagation(){} };
  handlers.forEach(fn=>fn(evt));
}

const sheetEl = elStore.sheet || (elStore.sheet = mkEl("sheet"));

// -------- FABメニューに「ひと段落」がある --------
T.state.tab = "today";
sandbox.openFab();
const fabHtml = elStore.fabMenu ? elStore.fabMenu.innerHTML : "";
ok("FAB menu includes a 'ひと段落' button wired to open-hitodanraku", fabHtml.includes("ひと段落") && fabHtml.includes('data-act="open-hitodanraku"'));

// -------- open-hitodanraku でシートが開く --------
dispatchClick("open-hitodanraku");
ok("open-hitodanraku opens the time-entry sheet with a time input", sheetEl.innerHTML.includes('id="hdTime"'));

// -------- キャンセルしても dayMeta に変更が入らない（案A: 生成した時だけ保存） --------
T.db.dayMeta = {};
dispatchClick("close-sheet");
ok("closing the initial sheet without generating leaves dayMeta untouched", !T.db.dayMeta[TODAY] || T.db.dayMeta[TODAY].hitodanrakuAt === undefined);

// -------- hd-generate で dayMeta に時刻が保存され、プレビューが開く --------
T.db.tasks = [
  { id:"skillA", name:"スキルA", kind:"repeat", rtype:"skill", freq:{type:"daily"}, estMin:20, createdAt:"1" },
];
T.db.occurrences = [];
elStore.hdTime = mkEl("hdTime");
elStore.hdTime.value = "20:00";
dispatchClick("hd-generate");
ok("hd-generate records the entered time into dayMeta for today", T.db.dayMeta[TODAY] && T.db.dayMeta[TODAY].hitodanrakuAt === "20:00");
ok("hd-generate opens the preview sheet listing the candidate", sheetEl.innerHTML.includes("スキルA") && sheetEl.innerHTML.includes('id="hdList"'));

// -------- 空き時間なし・候補なしの案内分岐 --------
T.db.dayMeta = {};
elStore.hdTime.value = "24:59";   // barely any time left before 25:00 bedtime, and no candidates fit
dispatchClick("hd-generate");
ok("hd-generate shows a no-time/no-candidates message when nothing fits, with no confirm button", !sheetEl.innerHTML.includes('data-act="hd-confirm"'));

// -------- hd-confirm でチェック済みの行だけ occurrence が作られる --------
T.db.occurrences = [];
hdCandRows = [
  { dataset:{taskid:"skillA", start:"20:00", min:"20"}, querySelector(sel){ return sel==='[data-f="sel"]' ? {checked:true} : mkEl(); } },
];
dispatchClick("hd-confirm");
ok("hd-confirm creates exactly one occurrence for the checked candidate", T.db.occurrences.length===1 && T.db.occurrences[0].taskId==="skillA" && T.db.occurrences[0].plannedStart==="20:00" && T.db.occurrences[0].plannedMin===20);
ok("the created occurrence uses the standard shape (planned, not done)", T.db.occurrences[0].status==="planned" && T.db.occurrences[0].actualMin===null);

// -------- 未チェックの行は確定対象から外れる --------
T.db.occurrences = [];
hdCandRows = [
  { dataset:{taskid:"skillA", start:"20:00", min:"20"}, querySelector(sel){ return sel==='[data-f="sel"]' ? {checked:false} : mkEl(); } },
];
dispatchClick("hd-confirm");
ok("unchecking a candidate excludes it from confirmation", T.db.occurrences.length===0);

console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAILURES`);
process.exit(fail ? 1 : 0);
