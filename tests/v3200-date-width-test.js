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

const documentListeners = {};
const elStore = { main: mkEl("main") };
const fakeDocument = {
  addEventListener(ev, fn){ (documentListeners[ev] = documentListeners[ev]||[]).push(fn); },
  getElementById(id){ if(!elStore[id]) elStore[id] = mkEl(id); return elStore[id]; },
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
vm.runInContext(`globalThis.__t = { get db(){ return db; }, set db(v){ db=v; }, get state(){ return state; }, mdShort, dateLabel, todayStr, renderTasks };`, sandbox);
const T = sandbox.__t;
const today = T.todayStr();
const thisYear = +today.slice(0,4);
const nextYear = thisYear + 1;

// v3.200: 「開いたら正確な年月はわかるので、そこは表示しないにしてもよさそう？」
// との指示で、一覧の枠用の短縮表示(mdShort)から年表示を削除した。これにより
// 最長ケースが「YY/M/D」(実測76px、72pxの枠でも収まっていなかった)から
// 「M/D」(実測60px)まで縮み、開始/期限の枠を72px→64pxに詰められるようになった
// （上旬/中旬/下旬/月の表示はどれも56px以下で、この変更の影響を受けない）。
// 編集シート側の表示(dateLabel)は、今年以外は「YYYY年」を付けたまま変更していない
// ——一覧では年違いかどうかの区別は不要だが、編集時は正確な年が分かる必要がある。

ok("mdShort: 今年の日付は年を付けない（M/D）", T.mdShort(`${thisYear}-11-05`, "day") === "11/5");
ok("mdShort: 年が違う日付でも年を付けない（M/D のまま）", T.mdShort(`${nextYear}-01-05`, "day") === "1/5");
ok("mdShort: 月精度は年を付けない（M月）", T.mdShort(`${nextYear}-12-01`, "month") === "12月");
ok("mdShort: 上旬/中旬/下旬も年を付けない（M B/M/E）", T.mdShort(`${nextYear}-12-05`, "early") === "12 B");
ok("mdShort: 空文字は空のまま", T.mdShort("", "day") === "");

// dateLabel（編集シート側）は今年以外なら引き続き「YYYY年」が付く——
// 一覧とシートで役割が違う（一覧=ざっくり区別、シート=正確な値）ことの確認。
ok("dateLabel: 今年の日付には年を付けない", T.dateLabel(`${thisYear}-11-05`, "day") === "11/5");
ok("dateLabel: 年が違う日付には「YYYY年」を付ける（編集時は正確な年が必要）", T.dateLabel(`${nextYear}-01-05`, "day") === `${nextYear}年1/5`);

// 実際のタスク一覧表示でも、年が違う開始/期限の日付が「M/D」のみ（年なし）で
// 表示されることを確認する。
T.db.tasks = [
  { id:"t1", name:"来年のタスク", kind:"single", freq:null, estMin:30, category:"学習",
    note:"", due:`${nextYear}-01-20`, duePrec:"day", prio:"low",
    startDate:`${nextYear}-01-05`, startPrec:"day", rtype:null, done:false, createdAt:today },
];
T.db.occurrences = [];
T.state.tasksView = "single";
T.renderTasks();
{
  const html = sandbox.document.getElementById("main").innerHTML;
  ok("一覧表示でも年が違う開始日が「M/D」のみ（年プレフィックス無し）",
    html.includes('<span class="tf-v">1/5</span>') && !html.includes(`${String(nextYear).slice(2)}/1/5`));
  ok("一覧表示でも年が違う期限日が「M/D」のみ（年プレフィックス無し）",
    html.includes('<span class="tf-v">1/20</span>') && !html.includes(`${String(nextYear).slice(2)}/1/20`));
}

console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAILURES`);
process.exit(fail ? 1 : 0);
