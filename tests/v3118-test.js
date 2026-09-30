const fs = require("fs");
const vm = require("vm");
const path = require("path");

const src = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");

let fail = 0;
function ok(name, cond){
  if(cond){ console.log("PASS", name); } else { console.log("FAIL", name); fail++; }
}

function mkEl(){
  const listeners = {};
  const el = {
    _html: "", value: "",
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

const fakeDocument = {
  addEventListener(ev, fn){ (documentListeners[ev] = documentListeners[ev]||[]).push(fn); },
  getElementById(id){ if(!elStore[id]) elStore[id] = mkEl(); return elStore[id]; },
  querySelector(){ return mkEl(); },
  querySelectorAll(){ return []; },
  createElement(){ return mkEl(); },
  body: mkEl(), documentElement: mkEl(),
};

let fetchCalls = [];

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
  navigator: {
    onLine: true,
    serviceWorker: {
      register: () => Promise.reject(new Error("not registered in test")),
      get ready(){ return Promise.resolve({ pushManager: { getSubscription: () => Promise.resolve(null) } }); },
    },
    clipboard: { writeText: ()=>Promise.resolve() },
  },
  fetch: async (url, opts) => { fetchCalls.push({ url, opts }); return { ok: true, status: 200, json: async()=>({ok:true}) }; },
  setTimeout, clearTimeout, setInterval, clearInterval,
  requestAnimationFrame: (fn)=>setTimeout(fn,0),
  history: { replaceState(){} },
  location: { hash:"", search:"", href:"http://localhost/" },
  alert: ()=>{}, confirm: ()=>true,
  Notification: { requestPermission: () => Promise.resolve("granted") },
  PushManager: function(){},
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
  get pushSubState(){ return pushSubState; }, set pushSubState(v){ pushSubState=v; },
  todaysTimedTasks, schedulePushTasksSync, todayStr,
};`, sandbox);
const T = sandbox.__t;

function flush(n){ return n<=0 ? Promise.resolve() : Promise.resolve().then(()=>flush(n-1)); }

const today = T.todayStr();

// v3.118（Phase 4）: 「毎朝8時のまとめ通知」は廃止し、時間が決まっている
// タスクの時刻ごとに個別通知する方式に置き換えた——ユーザーの指示
// 「通知はタスクごとに個別」。

// -------- Test 1: todaysTimedTasks() は時刻ありの未完了タスクだけをid付きで集める --------
T.db.occurrences = [
  { id:"o1", date: today, title: "歯磨き", status: "planned", plannedStart: "07:30" },
  { id:"o2", date: today, title: "水", status: "planned", plannedStart: "10:00" },
  { id:"o3", date: today, title: "水", status: "planned", plannedStart: "14:00" },   // 同名でも別occurrenceなら両方残る
  { id:"o4", date: today, title: "仕事", status: "done", plannedStart: "09:00" },     // 完了済みは除外
  { id:"o5", date: today, title: "起床", status: "planned", plannedStart: "06:00", plan: true }, // 予定は除外
  { id:"o6", date: today, title: "時間未定タスク", status: "planned" },                // 時刻なしは除外
  { id:"o7", date: "2000-01-01", title: "昔のタスク", status: "planned", plannedStart: "08:00" }, // 別日は除外
];
const tasks = T.todaysTimedTasks();
const ids = tasks.map(t=>t.id);
ok("todaysTimedTasks includes today's timed, not-done, non-plan tasks", ids.includes("o1") && ids.includes("o2") && ids.includes("o3"));
ok("todaysTimedTasks excludes done occurrences", !ids.includes("o4"));
ok("todaysTimedTasks excludes plan/marker rows", !ids.includes("o5"));
ok("todaysTimedTasks excludes tasks with no set time", !ids.includes("o6"));
ok("todaysTimedTasks excludes other dates", !ids.includes("o7"));
ok("same-name occurrences at different times both survive (not deduped by name)", tasks.filter(t=>t.name==="水").length === 2);
const o1 = tasks.find(t=>t.id==="o1");
ok("each entry carries id, name, and time", o1 && o1.name === "歯磨き" && o1.time === "07:30");

// -------- Test 2: schedulePushTasksSync() は通知オフの間は何もしない --------
fetchCalls = [];
T.pushSubState = "off";
T.schedulePushTasksSync();
flush(10).then(() => {
  ok("no /today-digest request sent while pushSubState is 'off'", !fetchCalls.some(c=>c.url.endsWith("/today-digest")));

  // -------- Test 3: 通知オンなら、時刻ありタスクの一覧をdate+tasksで送る --------
  return new Promise(resolve => {
    fetchCalls = [];
    T.pushSubState = "on";
    T.schedulePushTasksSync();
    setTimeout(resolve, 3200);   // 3秒デバウンスを超えるまで待つ
  });
}).then(() => flush(5)).then(() => {
  const digestCall = fetchCalls.find(c => c.url.endsWith("/today-digest"));
  ok("a POST to PUSH_SERVER/today-digest was made while notifications are on", !!digestCall);
  ok("the request includes the shared token header", digestCall && digestCall.opts.headers["X-LifeCore-Token"] && digestCall.opts.headers["X-LifeCore-Token"].length > 0);
  const sentBody = digestCall ? JSON.parse(digestCall.opts.body) : null;
  ok("the request body has today's date", sentBody && sentBody.date === today);
  ok("the request body carries {id,name,time} tasks, not just names", sentBody && Array.isArray(sentBody.tasks) && sentBody.tasks.every(t=>t.id && t.name && t.time));
  ok("the request body excludes done/plan/untimed/other-date entries", sentBody && sentBody.tasks.length === 3);

  // -------- Test 4: 連続呼び出しはデバウンスされ、1回にまとまる --------
  fetchCalls = [];
  T.schedulePushTasksSync();
  T.schedulePushTasksSync();
  T.schedulePushTasksSync();
  return new Promise(resolve => setTimeout(resolve, 3200));
}).then(() => flush(5)).then(() => {
  const digestCalls = fetchCalls.filter(c => c.url.endsWith("/today-digest"));
  ok("rapid successive schedulePushTasksSync() calls debounce into exactly one request", digestCalls.length === 1);

  console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAILURES`);
  process.exit(fail ? 1 : 0);
}).catch(e => {
  console.log("TEST THREW:", e && e.stack || e);
  process.exit(1);
});
