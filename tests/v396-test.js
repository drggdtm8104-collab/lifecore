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
  navigator: { onLine: true },
  fetch: async () => ({ ok: true, status: 200, json: async()=>({ok:true}) }),
  setTimeout, clearTimeout, setInterval, clearInterval,
  requestAnimationFrame: (fn)=>setTimeout(fn,0),
  history: { replaceState(){} },
  location: { hash:"", search:"", href:"http://localhost/" },
  alert: ()=>{}, confirm: ()=>true,
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
  sheetRemark,
};`, sandbox);
const T = sandbox.__t;

function dispatchClick(dataAct, dataV, dataId){
  const t = mkEl();
  t.dataset = { act: dataAct, v: dataV, id: dataId };
  t.closest = function(sel){ if(sel === "[data-act]") return t; return null; };
  const handlers = documentListeners["click"] || [];
  const evt = { target: t, preventDefault(){}, stopPropagation(){} };
  handlers.forEach(fn=>fn(evt));
}

// 覚え書き（db.remarks）は v3.97 でメモ（db.notes）とは別の独立データとして
// 追加され、タスクタブ内の3つ目の切替（完了型／継続型／覚え書き）として
// 表示される（ユーザーの指示で、独立したタブではなくタスクタブの中に
// 置かれている）。

// -------- Test 1: タスクタブに「覚え書き」の切替セグメントがある --------
T.state.tab = "tasks";
T.render();
let mainHtml = sandbox.document.getElementById("main").innerHTML;
ok("tasks tab shows the 覚え書き segment toggle", mainHtml.includes("覚え書き") && mainHtml.includes('data-v="remarks"') && mainHtml.includes('data-act="tasks-view"'));

// -------- Test 2: 覚え書きが0件のときは空状態メッセージが出る --------
T.db.remarks = [];
T.state.tasksView = "remarks";
T.render();
mainHtml = sandbox.document.getElementById("main").innerHTML;
ok("empty remarks view shows the empty-state hint", mainHtml.includes("覚え書きはまだありません"));

// -------- Test 3: sheetRemark(null) で追加用シートが開く --------
T.sheetRemark(null);
let sheetHtml = sandbox.document.getElementById("sheet").innerHTML;
ok("sheetRemark(null) opens the add sheet with a text field", sheetHtml.includes('id="rmText"'));
ok("sheetRemark(null) has no 削除 button (nothing to delete yet)", !sheetHtml.includes('data-act="del-remark"'));

// -------- Test 4: save-remark で新規追加される --------
sandbox.document.getElementById("rmText").value = "換気を忘れずに";
dispatchClick("save-remark");
ok("save-remark adds a new entry to db.remarks", T.db.remarks.length === 1);
ok("the new remark has the entered text", T.db.remarks[0].text === "換気を忘れずに");
ok("the new remark defaults to prio 'low' (no selector match in this test harness)", T.db.remarks[0].prio === "low");
const remarkId = T.db.remarks[0].id;

// -------- Test 5: 一覧に反映され、空状態は出なくなる --------
T.render();
mainHtml = sandbox.document.getElementById("main").innerHTML;
ok("remarks view no longer shows the empty-state hint", !mainHtml.includes("覚え書きはまだありません"));
ok("remarks view shows the new remark's full text", mainHtml.includes("換気を忘れずに"));
ok("segment badge shows the count", mainHtml.includes('<span class="seg-badge">1</span>'));

// -------- Test 6: edit-remark で既存の内容がシートに入る --------
dispatchClick("edit-remark", null, remarkId);
sheetHtml = sandbox.document.getElementById("sheet").innerHTML;
ok("edit-remark opens the sheet pre-filled with the existing text", sheetHtml.includes("換気を忘れずに"));
ok("edit-remark's sheet has a 削除 button", sheetHtml.includes('data-act="del-remark"'));

// -------- Test 7: save-remark（id付き）で更新される（新規追加されない） --------
sandbox.document.getElementById("rmText").value = "換気と施錠を忘れずに";
dispatchClick("save-remark", null, remarkId);
ok("save-remark with an id updates in place, not a new entry", T.db.remarks.length === 1);
ok("the remark's text was updated", T.db.remarks[0].text === "換気と施錠を忘れずに");

// -------- Test 8: 表示期間外（showTo が過去）のものは rm-dim ＋「表示期間外」に分けられる --------
T.db.remarks.push({ id:"old1", text:"去年までの注意事項", prio:"low", showFrom:null, showTo:"2000-01-01", createdAt:"", updatedAt:"" });
T.render();
mainHtml = sandbox.document.getElementById("main").innerHTML;
ok("an out-of-period remark is marked with rm-dim", /remark-item rm-dim"[^>]*data-id="old1"/.test(mainHtml));
ok("an out-of-period remark is listed under a 表示期間外 heading", mainHtml.includes("表示期間外"));
ok("the in-period remark is not marked rm-dim", !new RegExp(`remark-item rm-dim"[^>]*data-id="${remarkId}"`).test(mainHtml));

// -------- Test 9: del-remark は確認シートを経由し、confirm-yes で実際に削除される --------
T.db.remarks = T.db.remarks.filter(r=>r.id!=="old1");   // isolate: back to just the one real remark
dispatchClick("del-remark", null, remarkId);
sheetHtml = sandbox.document.getElementById("sheet").innerHTML;
ok("del-remark opens a confirmation sheet instead of deleting immediately", T.db.remarks.length === 1 && sheetHtml.includes('data-act="confirm-yes"'));
dispatchClick("confirm-yes");
ok("confirm-yes actually deletes the remark", T.db.remarks.length === 0);
T.render();
mainHtml = sandbox.document.getElementById("main").innerHTML;
ok("after deleting the only remark, the empty-state hint returns", mainHtml.includes("覚え書きはまだありません"));

console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAILURES`);
process.exit(fail ? 1 : 0);
