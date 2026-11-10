const fs = require("fs");
const vm = require("vm");
const path = require("path");

const src = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");

let fail = 0;
function ok(name, cond){
  if(cond){ console.log("PASS", name); } else { console.log("FAIL", name); fail++; }
}

function mkEl(id){
  const el = {
    id, _html: "", value: "",
    classList: { add(){}, remove(){}, toggle(){}, contains(){return false;} },
    style: {}, dataset: {}, children: [],
    addEventListener(){}, querySelector(){ return mkEl(); }, querySelectorAll(){ return []; },
    closest(){ return null; }, appendChild(){}, remove(){}, focus(){},
    get innerHTML(){ return this._html; }, set innerHTML(v){ this._html = v; },
    getAttribute(){ return null; }, setAttribute(){},
  };
  return el;
}

const elStore = { main: mkEl("main"), fab: mkEl(), fabMenu: mkEl() };
const fakeDocument = {
  addEventListener(){}, getElementById(id){ if(!elStore[id]) elStore[id] = mkEl(id); return elStore[id]; },
  querySelector(){ return mkEl(); }, querySelectorAll(){ return []; },
  createElement(){ return mkEl(); }, body: mkEl(), documentElement: mkEl(),
};

const sandbox = {
  document: fakeDocument, window: {}, console,
  localStorage: (function(){
    let store = {};
    return { getItem(k){ return store[k]===undefined?null:store[k]; }, setItem(k,v){ store[k]=String(v); }, removeItem(k){ delete store[k]; } };
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
  crypto: require("crypto").webcrypto || { randomUUID(){ return require("crypto").randomUUID(); }, getRandomValues(arr){ return require("crypto").randomFillSync(arr); } },
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
vm.runInContext(`globalThis.__t = { get db(){ return db; }, set db(v){ db=v; }, get state(){ return state; }, renderToday, todayStr };`, sandbox);
const T = sandbox.__t;
const today = T.todayStr();

// v3.195: 「編集」「未達成」ボタンの枠（45×19px固定、chipStyle）を基準に、
// 状態バッジ（完了/延期/未実施/完了する）も同じ枠サイズに揃え、文字量の方を
// font-sizeで収める。これにより右側のボタン列は状態に関わらず常に同じ
// 縦位置に並ぶ。また「完了」バッジの所要時間（分）表示は廃止した
// （枠を固定サイズにするため、ラベルが可変長の文字列を含まないようにする）。

T.db.tasks = [{ id:"t1", name:"テストタスク", kind:"single", freq:null, estMin:null, category:"その他", note:"", due:null, duePrec:"day", prio:"low", startDate:null, startPrec:"day", rtype:null, done:false, createdAt:today }];
T.db.occurrences = [{ id:"o1", taskId:"t1", date:today, plannedStart:null, plannedMin:null, actualMin:37, status:"done", doneAt:today+"T10:00", adhoc:false, title:null, note:"" }];
T.state.date = today;
T.state.todayView = "list";
T.renderToday();

const html = elStore.main._html;
ok("完了バッジに所要時間（分）は表示されない", /<span class="card-state done">完了<\/span>/.test(html));
ok("旧表示「完了 37分」はバッジ内にはもう出ない（card-meta側の所要時間表示とは別物）",
  !/<span class="card-state done">完了\s*37分<\/span>/.test(html));

const htmlSrc = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8").replace(/\s+/g, "");

ok(".card-stateの枠が編集/未達成ボタン(chipStyle)と同じ45×19pxに固定されている",
  /\.card-state\{flex:none;box-sizing:border-box;width:45px;height:19px;/.test(htmlSrc));
ok(".card-stateの枠はbox-sizing:border-boxで確定している",
  /\.card-state\{[^}]*box-sizing:border-box/.test(htmlSrc));
ok("chipStyle（編集/未達成ボタン）の枠サイズも45×19pxのまま変わっていない",
  /width:45px;height:19px;min-height:0/.test(htmlSrc));
ok(".card-head-actionsは中央揃え（align-items:center）で縦位置を揃えている",
  /\.card-head-actions\{margin-left:auto;flex:none;display:inline-flex;align-items:center;/.test(htmlSrc));

console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAILURES`);
process.exit(fail ? 1 : 0);
