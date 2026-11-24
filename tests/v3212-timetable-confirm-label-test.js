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

// v3.212: 「スケジュールタブのタイムテーブルに出てくるタスクは未完了のボタンが
// 「完了する」になっているが、押してもそれで完了するわけではない」との指摘。
// タイムテーブル側（!listView）の状態バッジは toggle-occ-done ではなく
// goto-task-in-list（「今日のタスク」一覧へジャンプするだけ）に繋がっている
// ため、「完了する」という能動的な文言は押せば完了すると誤解させる。
// listView（ToDoリスト、実際にトグルするボタン）はそのまま「完了する」、
// タイムテーブル側だけ「確認」に差し替える。

T.db.tasks = [{ id:"t1", name:"洗濯", kind:"single", estMin:10, category:"家事", note:"", due:null, duePrec:"day", prio:"low", startDate:null, startPrec:"day", rtype:"task", done:false, createdAt:today }];

const occ = { id:"o1", taskId:"t1", date:today, status:"planned", plannedStart:"09:00", plannedMin:10, actualMin:null, doneAt:null, adhoc:false, title:null, note:"" };

const htmlList = T.cardHTML(occ, true);
ok("list-view (ToDoリスト) planned badge still says 完了する", htmlList.includes(">完了する<"));
ok("list-view planned badge is wired to toggle-occ-done", /data-act="toggle-occ-done"[^>]*>[^<]*<span class="card-state todo">完了する<\/span>/.test(htmlList));

const htmlTimeline = T.cardHTML(occ, false);
ok("timetable (!listView) planned badge now says 確認, not 完了する", htmlTimeline.includes(">確認<") && !htmlTimeline.includes("完了する"));
ok("timetable planned badge is wired to goto-task-in-list, not toggle-occ-done", /data-act="goto-task-in-list"[^>]*>[^<]*<span class="card-state todo">確認<\/span>/.test(htmlTimeline) && !htmlTimeline.includes('data-act="toggle-occ-done"'));

// 他ステータスのバッジ文言（完了/延期/未実施）はlistView・timetable両方で変わらないこと。
for(const [status, label] of [["done","完了"], ["deferred","延期"], ["skipped","未実施"]]){
  const o = Object.assign({}, occ, { status });
  const hList = T.cardHTML(o, true);
  const hTl = T.cardHTML(o, false);
  ok(`${status} badge label unchanged in list view`, hList.includes(">" + label + "<"));
  ok(`${status} badge label unchanged in timetable view`, hTl.includes(">" + label + "<"));
}

console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAILURES`);
process.exit(fail ? 1 : 0);
