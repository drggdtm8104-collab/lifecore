const fs = require("fs");
const vm = require("vm");
const path = require("path");

const src = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");

let fail = 0;
function ok(name, cond){
  if(cond){ console.log("PASS", name); } else { console.log("FAIL", name); fail++; }
}

function mkEl(){
  const el = {
    _html: "", value: "",
    classList: { add(){}, remove(){}, toggle(){}, contains(){return false;} },
    style: {}, dataset: {}, children: [],
    addEventListener(){}, querySelector(){ return mkEl(); }, querySelectorAll(){ return []; },
    closest(){ return null; }, appendChild(){}, remove(){}, focus(){}, select(){}, click(){},
    get innerHTML(){ return this._html; }, set innerHTML(v){ this._html = v; },
    getAttribute(){ return null; }, setAttribute(){},
  };
  return el;
}

const documentListeners = {};
const elStore = { main: mkEl(), fab: mkEl(), fabMenu: mkEl() };
const fakeDocument = {
  addEventListener(ev, fn){ (documentListeners[ev] = documentListeners[ev]||[]).push(fn); },
  getElementById(id){ if(!elStore[id]) elStore[id] = mkEl(); return elStore[id]; },
  querySelector(){ return mkEl(); }, querySelectorAll(){ return []; },
  createElement(){ return mkEl(); }, body: mkEl(), documentElement: mkEl(),
};

let fetchCalls = [];
const sandbox = {
  document: fakeDocument, window: {}, console,
  localStorage: (function(){
    let store = {};
    return { getItem(k){ return store[k]===undefined?null:store[k]; }, setItem(k,v){ store[k]=String(v); }, removeItem(k){ delete store[k]; } };
  })(),
  navigator: { onLine: true, serviceWorker: { register: () => Promise.reject(new Error("not registered")), get ready(){ return Promise.resolve({ pushManager:{ getSubscription:()=>Promise.resolve(null) } }); } }, clipboard: { writeText: ()=>Promise.resolve() } },
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
  crypto: require("crypto").webcrypto || { randomUUID(){ return require("crypto").randomUUID(); } },
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
vm.runInContext(`globalThis.__t = { get db(){ return db; }, set db(v){ db=v; }, get state(){ return state; } };`, sandbox);
const T = sandbox.__t;

function dispatchClick(target){
  const handlers = documentListeners["click"] || [];
  const evt = { target, preventDefault(){}, stopPropagation(){} };
  handlers.forEach(fn=>fn(evt));
}
function fakeTarget(dataAct, dataId){
  const t = mkEl();
  t.dataset = { act: dataAct, id: dataId };
  t.closest = function(sel){ if(sel === "[data-act]") return t; return null; };
  return t;
}

// ---- setup: a repeat task with one planned occurrence today ----
T.db.tasks.push({ id:"t1", name:"皿洗い", kind:"repeat", freq:{type:"daily"}, category:"家事",
  note:"", due:null, prio:"low", startDate:null, rtype:"routine", done:false, createdAt:"2026-10-19" });
T.db.occurrences.push({ id:"occ1", taskId:"t1", date:"2026-10-19", plannedStart:null, plannedMin:null,
  actualMin:null, status:"planned", doneAt:null, adhoc:false, title:null, note:"", plan:false });
T.state.date = "2026-10-19";

// -------- 1: completing fires /task-event with task.completed --------
dispatchClick(fakeTarget("toggle-occ-done", "occ1"));
let call = fetchCalls.find(c => c.url.endsWith("/task-event"));
ok("completing posts to /task-event", !!call);
ok("the request includes the shared token header", call && call.opts.headers["X-LifeCore-Token"] && call.opts.headers["X-LifeCore-Token"].length > 0);
let payload = call ? JSON.parse(call.opts.body) : null;
ok("id is the occurrence's own id", payload && payload.id === "occ1");
ok("type is task.completed", payload && payload.type === "task.completed");
ok("task is the underlying task's id", payload && payload.task === "t1");
ok("title is the task's display name", payload && payload.title === "皿洗い");
ok("at is a valid ISO date string", payload && !Number.isNaN(Date.parse(payload.at)));

// -------- 2: undoing fires /task-event with task.uncompleted, same id --------
fetchCalls = [];
dispatchClick(fakeTarget("toggle-occ-done", "occ1"));
call = fetchCalls.find(c => c.url.endsWith("/task-event"));
payload = call ? JSON.parse(call.opts.body) : null;
ok("undoing posts to /task-event", !!call);
ok("undo keeps the same id as the completion", payload && payload.id === "occ1");
ok("undo's type is task.uncompleted", payload && payload.type === "task.uncompleted");

// -------- 3: an ad-hoc occurrence (no underlying task) falls back to its own id for "task" --------
T.db.occurrences.push({ id:"occ2", taskId:null, date:"2026-10-19", plannedStart:null, plannedMin:null,
  actualMin:null, status:"planned", doneAt:null, adhoc:true, title:"単発の用事", note:"", plan:false });
fetchCalls = [];
dispatchClick(fakeTarget("toggle-occ-done", "occ2"));
call = fetchCalls.find(c => c.url.endsWith("/task-event"));
payload = call ? JSON.parse(call.opts.body) : null;
ok("ad-hoc occurrence also posts to /task-event", !!call);
ok("ad-hoc occurrence's task falls back to its own occurrence id", payload && payload.task === "occ2");
ok("ad-hoc occurrence's title is its own title", payload && payload.title === "単発の用事");

// -------- 4: a long task name is truncated to 100 chars for "title" --------
const longName = "あ".repeat(150);
T.db.tasks.push({ id:"t2", name:longName, kind:"repeat", freq:{type:"daily"}, category:"家事",
  note:"", due:null, prio:"low", startDate:null, rtype:"routine", done:false, createdAt:"2026-10-19" });
T.db.occurrences.push({ id:"occ3", taskId:"t2", date:"2026-10-19", plannedStart:null, plannedMin:null,
  actualMin:null, status:"planned", doneAt:null, adhoc:false, title:null, note:"", plan:false });
fetchCalls = [];
dispatchClick(fakeTarget("toggle-occ-done", "occ3"));
call = fetchCalls.find(c => c.url.endsWith("/task-event"));
payload = call ? JSON.parse(call.opts.body) : null;
ok("a long title is truncated to 100 characters", payload && payload.title.length === 100);

// -------- 5: toggle-occ-unmet (skipped) does NOT fire a /task-event --------
T.db.occurrences.push({ id:"occ4", taskId:"t1", date:"2026-10-19", plannedStart:null, plannedMin:null,
  actualMin:null, status:"planned", doneAt:null, adhoc:false, title:null, note:"", plan:false });
fetchCalls = [];
dispatchClick(fakeTarget("toggle-occ-unmet", "occ4"));
call = fetchCalls.find(c => c.url.endsWith("/task-event"));
ok("marking 未達成 (skipped) does not post to /task-event", !call);

console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAILURES`);
process.exit(fail ? 1 : 0);
