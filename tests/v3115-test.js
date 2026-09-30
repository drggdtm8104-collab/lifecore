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
const M = mkEl();
const FAB = mkEl();
const FABM = mkEl(); FABM.hidden = true;
const elStore = { main: M, fab: FAB, fabMenu: FABM };

const fakeDocument = {
  addEventListener(ev, fn){ (documentListeners[ev] = documentListeners[ev]||[]).push(fn); },
  getElementById(id){ if(!elStore[id]) elStore[id] = mkEl(); return elStore[id]; },
  querySelector(){ return mkEl(); },
  querySelectorAll(){ return []; },
  createElement(){ return mkEl(); },
  body: mkEl(), documentElement: mkEl(),
};

let fetchCalls = [];
let fakeSubscription = null;
let swReady = null;

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
      get ready(){ return swReady; },
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
vm.runInContext(`globalThis.__t = { get db(){ return db; }, set db(v){ db=v; }, get state(){ return state; }, render, get pushSubState(){ return pushSubState; }, urlBase64ToUint8Array };`, sandbox);
const T = sandbox.__t;

function dispatchClick(target){
  const handlers = documentListeners["click"] || [];
  const evt = { target, preventDefault(){}, stopPropagation(){} };
  handlers.forEach(fn=>fn(evt));
}
function fakeTarget(dataAct, dataV, dataId){
  const t = mkEl();
  t.dataset = { act: dataAct, v: dataV, id: dataId };
  t.closest = function(sel){ if(sel === "[data-act]") return t; return null; };
  t.getAttribute = function(attr){
    if(attr==="data-act") return dataAct;
    if(attr==="data-v") return dataV;
    if(attr==="data-id") return dataId;
    return null;
  };
  return t;
}

// -------- Test 1: urlBase64ToUint8Array decodes the real VAPID public key to 65 bytes (uncompressed EC point) --------
const vapidKeyFromSource = (src.match(/PUSH_VAPID_PUBLIC_KEY = "([^"]+)"/) || [])[1];
ok("PUSH_VAPID_PUBLIC_KEY constant found in source", !!vapidKeyFromSource);
const decoded = T.urlBase64ToUint8Array(vapidKeyFromSource);
ok("decoded VAPID public key is 65 bytes (uncompressed P-256 point)", decoded.length === 65);
ok("decoded VAPID public key starts with 0x04 (uncompressed point marker)", decoded[0] === 4);

// -------- Test 2: subscribing (toggle-push while off) requests permission, subscribes, and POSTs to /subscribe --------
fakeSubscription = {
  endpoint: "https://fake-push-service.example/abc123",
  toJSON(){ return { endpoint: this.endpoint, keys: { p256dh: "x", auth: "y" } }; },
  unsubscribe: () => Promise.resolve(true),
};
swReady = Promise.resolve({
  pushManager: {
    getSubscription: () => Promise.resolve(T.pushSubState === "on" ? fakeSubscription : null),
    subscribe: (opts) => { subscribeOpts = opts; return Promise.resolve(fakeSubscription); },
  },
});
let subscribeOpts = null;

T.state.tab = "settings";
T.render();
dispatchClick(fakeTarget("toggle-push"));

// flush microtasks (multiple awaits in the async handler)
function flush(n){ return n<=0 ? Promise.resolve() : Promise.resolve().then(()=>flush(n-1)); }

flush(10).then(() => {
  ok("subscribe() was called with userVisibleOnly:true", !!subscribeOpts && subscribeOpts.userVisibleOnly === true);
  ok("subscribe() applicationServerKey is a 65-byte Uint8Array", subscribeOpts && subscribeOpts.applicationServerKey && subscribeOpts.applicationServerKey.length === 65);
  const subscribeCall = fetchCalls.find(c => c.url.endsWith("/subscribe"));
  ok("a POST to PUSH_SERVER/subscribe was made", !!subscribeCall);
  ok("the subscribe request includes the shared token header", subscribeCall && subscribeCall.opts.headers["X-LifeCore-Token"] && subscribeCall.opts.headers["X-LifeCore-Token"].length > 0);
  const sentBody = subscribeCall ? JSON.parse(subscribeCall.opts.body) : null;
  ok("the subscribe request body is the subscription JSON (has endpoint)", sentBody && sentBody.endpoint === fakeSubscription.endpoint);
  ok("pushSubState became 'on' after subscribing", T.pushSubState === "on");

  // -------- Test 3: toggling again (now "on") unsubscribes and POSTs to /unsubscribe --------
  fetchCalls = [];
  dispatchClick(fakeTarget("toggle-push"));
  return flush(10);
}).then(() => {
  const unsubCall = fetchCalls.find(c => c.url.endsWith("/unsubscribe"));
  ok("a POST to PUSH_SERVER/unsubscribe was made when toggling off", !!unsubCall);
  ok("pushSubState became 'off' after unsubscribing", T.pushSubState === "off");

  console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAILURES`);
  process.exit(fail ? 1 : 0);
}).catch(e => {
  console.log("TEST THREW:", e && e.stack || e);
  process.exit(1);
});
