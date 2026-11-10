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

// v3.193: 「未完了」は状態の名詞で、押すと「終わらなかった」という意味で
// 押しているのか紛らわしいとの指摘で、完了させるための状態バッジ（タップで
// 完了⇔未完了を切り替える）のラベルを「未完了」から動詞「済ます」に変更。
// 一方、ToDoリストの見出し（未完了/完了でグループ分けする`renderStatusGroup`
// のラベル）は状態を表す見出しであって押すボタンではないので、そのまま
// 「未完了」のままにしている。
// v3.194: 「済ます」から「完了する」に変更。

T.db.tasks = [{ id:"t1", name:"テストタスク", kind:"single", freq:null, estMin:null, category:"その他", note:"", due:null, duePrec:"day", prio:"low", startDate:null, startPrec:"day", rtype:null, done:false, createdAt:today }];
T.db.occurrences = [{ id:"o1", taskId:"t1", date:today, plannedStart:null, plannedMin:null, actualMin:null, status:"planned", doneAt:null, adhoc:false, title:null, note:"" }];
T.state.date = today;
T.state.todayView = "list";
T.renderToday();

const html = elStore.main._html;
ok("未完了の状態バッジのラベルは「完了する」になっている", /<span class="card-state todo">完了する<\/span>/.test(html));
ok("古いラベル「未完了」はこのバッジには使われていない", !/<span class="card-state todo">未完了<\/span>/.test(html));
ok("旧ラベル「済ます」はこのバッジには使われていない", !/<span class="card-state todo">済ます<\/span>/.test(html));
ok("ToDoリストの「未完了」見出し（グループ見出し、ボタンではない）はそのまま残っている", html.includes(">未完了<"));

console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAILURES`);
process.exit(fail ? 1 : 0);
