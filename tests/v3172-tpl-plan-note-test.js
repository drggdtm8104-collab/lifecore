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
const elStore = { main: mkEl("main"), fab: mkEl(), fabMenu: mkEl() };

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
vm.runInContext(`globalThis.__t = { get db(){ return db; }, set db(v){ db=v; }, todayStr, applyTemplate, renderTemplates, state };`, sandbox);
const T = sandbox.__t;
const today = T.todayStr();

// v3.172: 「テンプレでも予定にメモを出来るようにして」——以前はテンプレの
// 予定行（tpl.plans）には備考(note)を持たせる場所が無く、通常の予定登録
// (sheetMarker)にはある備考欄がテンプレ編集では出せなかった。

T.db.tasks = [];
T.db.occurrences = [];
T.db.dayMeta = {};
T.db.settings = {};
T.db.templates = [{
  id:"tpl1", name:"平日在宅",
  plans:[{ time:"09:00", label:"仕事", mins:480, category:"", freeBlock:false, note:"資料は前日に準備" }],
  tasks:[],
}];

// --- 1. テンプレを適用すると、その日の予定(occurrence)にも備考がコピーされる ---
T.applyTemplate(today, "tpl1");
{
  const o = T.db.occurrences.find(x=>x.plan && x.title==="仕事");
  ok("a plan occurrence was created from the template", !!o);
  ok("the template plan's note was copied onto the day's occurrence", o && o.note === "資料は前日に準備");
}

// --- 2. 備考を変えてテンプレを再適用すると、既存の実施側の備考も更新される
//        （freeBlockと同じ「毎回コピーし直す」仕様） ---
T.db.templates[0].plans[0].note = "買い物リストを忘れない";
T.applyTemplate(today, "tpl1");
{
  const o = T.db.occurrences.find(x=>x.plan && x.title==="仕事");
  ok("re-applying the template updates the existing occurrence's note", o && o.note === "買い物リストを忘れない");
}

// --- 3. 備考が空のテンプレ行なら、実施側も空のまま（undefinedでクラッシュしない） ---
T.db.occurrences = [];
T.db.templates[0].plans[0] = { time:"09:00", label:"仕事", mins:480, category:"", freeBlock:false };
T.applyTemplate(today, "tpl1");
{
  const o = T.db.occurrences.find(x=>x.plan && x.title==="仕事");
  ok("a plan with no note field at all still creates an occurrence", !!o);
  ok("its note defaults to an empty string", o && o.note === "");
}

// --- 4. テンプレ編集画面（編集タブ）に、備考欄(textarea, data-f=\"note\")が出る ---
T.state.settingsTplId = "tpl1";
T.state.tplView = "edit";
T.db.templates[0].plans[0] = { time:"09:00", label:"仕事", mins:480, category:"", freeBlock:false, note:"資料は前日に準備" };
T.state._tplDraft = null; // force rebuilding the draft from db.templates
T.renderTemplates();
{
  const html = elStore.main._html;
  ok("the plan-row editor renders a note textarea for the row", /id="tplNote-0"/.test(html));
  ok("the note textarea is marked data-f=\"note\" (read by readTplEditor)", /id="tplNote-0"[^>]*data-f="note"/.test(html) || /data-f="note"[^>]*id="tplNote-0"/.test(html));
  ok("the note textarea shows the current value", html.includes("資料は前日に準備"));
}

// --- 5. テンプレ編集画面（タイムライン表示）にも備考が見える ---
T.state.tplView = "timeline";
T.renderTemplates();
{
  const html = elStore.main._html;
  ok("the timeline preview shows the plan's note", html.includes('class="mk-note"') && html.includes("資料は前日に準備"));
}

console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAILURES`);
process.exit(fail ? 1 : 0);
