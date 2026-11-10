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

const elStore = { main: mkEl(), fab: mkEl(), fabMenu: mkEl() };
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
vm.runInContext(`globalThis.__t = { sheetTask };`, sandbox);
const T = sandbox.__t;

const sheetEl = elStore.sheet || (elStore.sheet = mkEl("sheet"));

// v3.191: 「期限など、下にも設定する行がある項目はそれらも含めてまとめて
// くくって」——.radio-row単体の項目(カテゴリ等)は.radio-rowだけを
// .tk-choice-groupで囲むが、開始時期・期限は.radio-row(精度選択)＋後続の
// 日付/月入力＋クリア行(.fld-row)まで、両方を同じ.tk-choice-groupで囲む。

T.sheetTask(null);
const html = sheetEl.innerHTML;

ok("カテゴリの.radio-rowは.tk-choice-groupで囲まれている",
  /<div class="tk-choice-group">\s*<div class="radio-row" id="tkCat">/.test(html));

// 期限(tkDuePrec)の.radio-rowと、そのあとの.fld-row（tkDue等を含む）が、
// 同じ.tk-choice-groupの中に一緒に入っている（間に別の.tk-choice-groupの
// 開始・終了タグが挟まらない）ことを確認する。
{
  const groupOpenTag = '<div class="tk-choice-group">\n      <div class="radio-row" id="tkDuePrec">';
  const startIdx = html.indexOf(groupOpenTag);
  ok("期限のtk-choice-groupが見つかる", startIdx !== -1);
  const body = html.slice(startIdx + groupOpenTag.length);
  const closeIdx = body.indexOf("tk-due-clear");
  ok("そのグループの中（クリアボタンが出るまでの間）に、別のtk-choice-groupの開始タグが挟まらない",
    closeIdx !== -1 && !body.slice(0, closeIdx).includes('class="tk-choice-group"'));
}

console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAILURES`);
process.exit(fail ? 1 : 0);
