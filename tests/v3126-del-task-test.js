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
vm.runInContext(`globalThis.__t = { get db(){ return db; }, set db(v){ db=v; }, todayStr };`, sandbox);
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

// v3.126: ユーザー報告 — ToDoリストに追加したタスクを「タスク」タブから
// 削除すると、紐づくoccurrenceは消えずに残り、occName()が「(削除済み)」と
// 表示してしまい、ToDoリストに消せない項目として残り続けていた。
// 「過去の記録は残ります」という確認文言どおり、完了・延期・未実施などの
// 決着済みの記録は残しつつ、まだ終わっていない(status:"planned")ぶんだけは
// タスク削除と一緒に消えるべき、という修正。

T.db.tasks = [{ id:"t1", name:"消すタスク", kind:"single", freq:null, estMin:null, category:"その他", note:"", due:null, duePrec:"day", prio:"low", startDate:null, startPrec:"day", rtype:null, done:false, createdAt:today }];
T.db.occurrences = [
  { id:"o1", taskId:"t1", date:today, status:"planned", plannedStart:null, plannedMin:null, actualMin:null, doneAt:null, adhoc:false, title:null, note:"" },           // 今日まだ未完了
  { id:"o2", taskId:"t1", date:today, status:"done", plannedStart:null, plannedMin:null, actualMin:10, doneAt:"x", adhoc:false, title:null, note:"" },                  // 今日すでに完了
  { id:"o3", taskId:"t1", date:"2000-01-01", status:"done", plannedStart:null, plannedMin:null, actualMin:10, doneAt:"x", adhoc:false, title:null, note:"" },           // 過去の完了記録
  { id:"o4", taskId:"t1", date:"2000-01-02", status:"deferred", plannedStart:null, plannedMin:null, actualMin:null, doneAt:null, adhoc:false, title:null, note:"" },    // 過去の延期記録
  { id:"o5", taskId:"t1", date:"2000-01-03", status:"skipped", plannedStart:null, plannedMin:null, actualMin:null, doneAt:null, adhoc:false, title:null, note:"" },     // 過去の未実施記録
  { id:"o6", taskId:"t1", date:"2099-01-01", status:"planned", plannedStart:null, plannedMin:null, actualMin:null, doneAt:null, adhoc:false, title:null, note:"" },     // 未来の未完了
  { id:"other", taskId:"t2", date:today, status:"planned", plannedStart:null, plannedMin:null, actualMin:null, doneAt:null, adhoc:false, title:null, note:"" },         // 別タスクの実施（無関係）
];

dispatchClick("del-task", { id:"t1" });
dispatchClick("confirm-yes");   // askConfirm経由なので、確認ダイアログの「実行する」も発火させる

ok("the task itself is removed", !T.db.tasks.some(t=>t.id==="t1"));
ok("today's not-yet-done (planned) occurrence is removed", !T.db.occurrences.some(o=>o.id==="o1"));
ok("a future not-yet-done (planned) occurrence is also removed", !T.db.occurrences.some(o=>o.id==="o6"));
ok("today's already-done occurrence is kept (it's a closed record, not pending)", T.db.occurrences.some(o=>o.id==="o2"));
ok("a past done record is kept", T.db.occurrences.some(o=>o.id==="o3"));
ok("a past deferred record is kept", T.db.occurrences.some(o=>o.id==="o4"));
ok("a past skipped record is kept", T.db.occurrences.some(o=>o.id==="o5"));
ok("an unrelated task's occurrence is untouched", T.db.occurrences.some(o=>o.id==="other"));

console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAILURES`);
process.exit(fail ? 1 : 0);
