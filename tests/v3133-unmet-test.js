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
    appendChild(){}, focus(){}, remove(){},
    get innerHTML(){ return this._html; },
    set innerHTML(v){ this._html = v; },
    getAttribute(){ return null; }, setAttribute(){},
    __listeners: listeners,
  };
  return el;
}

const documentListeners = {};
const elStore = { main: mkEl(), fab: mkEl(), fabMenu: mkEl() };

const fakeDocument = {
  addEventListener(ev, fn){ (documentListeners[ev] = documentListeners[ev]||[]).push(fn); },
  getElementById(id){ if(!elStore[id]) elStore[id] = mkEl(id); return elStore[id]; },
  querySelector(){ return mkEl(); },
  querySelectorAll(){ return []; },
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
  navigator: { onLine: true, serviceWorker: undefined },
  fetch: async ()=>({ ok:false }),
  setTimeout, clearTimeout, setInterval, clearInterval,
  requestAnimationFrame: (fn)=>setTimeout(fn,0),
  history: { replaceState(){} },
  location: { hash:"", search:"", href:"http://localhost/" },
  alert: ()=>{}, confirm: ()=>true,
  Notification: undefined, visualViewport: undefined,
  performance: { now:()=>Date.now() },
  crypto: require("crypto").webcrypto || {
    randomUUID(){ return require("crypto").randomUUID(); },
    getRandomValues(arr){ return require("crypto").randomFillSync(arr); },
  },
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
vm.runInContext(`globalThis.__t = { get db(){ return db; }, set db(v){ db=v; }, todayStr, cardHTML };`, sandbox);
const T = sandbox.__t;
const today = T.todayStr();

function dispatchClick(dataAct, extra){
  const t = mkEl();
  t.dataset = Object.assign({ act: dataAct }, extra||{});
  t.closest = function(sel){ if(sel === "[data-act]") return t; return null; };
  const handlers = documentListeners["click"] || [];
  const evt = { target: t, preventDefault(){}, stopPropagation(){} };
  handlers.forEach(fn=>fn(evt));
}

// v3.133: 「未達成」ボタン — 時間が決まっている継続型タスク（朝の水分補給など）は
// 時間を過ぎてからまとめてやっても意味がないことがある。見送り(skipped)を
// 手動でトグルできるようにし、「できなかった」の記録を残せるようにする。
// toggle-occ-doneと同じ考え方でskipped⇔plannedをトグルする。

T.db.tasks = [{ id:"t1", name:"水を飲む", kind:"repeat", freq:{type:"daily"}, estMin:5, category:"健康", note:"", due:null, duePrec:"day", prio:"low", startDate:null, startPrec:"day", rtype:"routine", done:false, createdAt:today }];
T.db.occurrences = [
  { id:"o1", taskId:"t1", date:today, status:"planned", plannedStart:"10:30", plannedMin:5, actualMin:null, doneAt:null, adhoc:false, title:null, note:"" },
  { id:"o2", taskId:"t1", date:today, status:"done", plannedStart:"17:00", plannedMin:5, actualMin:5, doneAt:"x", adhoc:false, title:null, note:"" },
];

// --- 1. planned -> skipped ---
dispatchClick("toggle-occ-unmet", { id:"o1" });
{
  const o = T.db.occurrences.find(x=>x.id==="o1");
  ok("clicking 未達成 on a planned occurrence marks it skipped", o.status==="skipped");
}

// --- 2. skipped -> planned (もう一度押すと前の状態に戻る) ---
dispatchClick("toggle-occ-unmet", { id:"o1" });
{
  const o = T.db.occurrences.find(x=>x.id==="o1");
  ok("clicking 未達成 again on a skipped occurrence reverts it to planned", o.status==="planned");
}

// --- 3. done -> skipped (actualMin/doneAtはクリアされる、single系タスクのdoneフラグも戻る) ---
dispatchClick("toggle-occ-unmet", { id:"o2" });
{
  const o = T.db.occurrences.find(x=>x.id==="o2");
  ok("clicking 未達成 on a done occurrence converts it to skipped", o.status==="skipped");
  ok("actualMin is cleared when moving away from done", o.actualMin===null);
  ok("doneAt is cleared when moving away from done", o.doneAt===null);
}

// --- 4. 「未達成」ボタンはToDoリスト（listView）にのみ表示され、編集と完了バッジの間にある ---
{
  const occ = { id:"o3", taskId:"t1", date:today, status:"planned", plannedStart:"23:00", plannedMin:5, actualMin:null, doneAt:null, adhoc:false, title:null, note:"" };
  const htmlList = T.cardHTML(occ, true);
  const idxEdit = htmlList.indexOf('data-act="edit-occ"');
  const idxUnmet = htmlList.indexOf('data-act="toggle-occ-unmet"');
  const idxStatus = htmlList.indexOf('data-act="toggle-occ-done"');
  ok("未達成 button appears in the list-view card", idxUnmet !== -1);
  ok("未達成 button sits between the edit button and the status badge", idxEdit !== -1 && idxStatus !== -1 && idxEdit < idxUnmet && idxUnmet < idxStatus);

  const htmlTimeline = T.cardHTML(occ, false);
  ok("未達成 button does NOT appear in the timeline (non-list) card", !htmlTimeline.includes('data-act="toggle-occ-unmet"'));
}

console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAILURES`);
process.exit(fail ? 1 : 0);
