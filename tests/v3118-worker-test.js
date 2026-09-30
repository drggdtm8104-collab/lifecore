const fs = require("fs");
const path = require("path");
const os = require("os");
const { pathToFileURL } = require("url");

let fail = 0;
function ok(name, cond){
  if(cond){ console.log("PASS", name); } else { console.log("FAIL", name); fail++; }
}

// worker.js は push-server/package.json が "type":"commonjs" のため、その場では
// import文を直接 import() できない（Nodeがモジュール種別をpackage.jsonから
// 決めるため）。テスト専用に .mjs としてtempへコピーしてから読み込む
// ——node --checkのときと同じ回避策。
function mkKvMock(initial){
  const store = new Map(Object.entries(initial || {}));
  const puts = [];
  return {
    _store: store,
    _puts: puts,
    async get(key){ return store.has(key) ? store.get(key) : null; },
    async put(key, value, opts){ store.set(key, value); puts.push({ key, value, opts }); },
    async delete(key){ store.delete(key); },
    async list({ prefix } = {}){
      const keys = [...store.keys()].filter(k => !prefix || k.startsWith(prefix)).map(name => ({ name }));
      return { keys };
    },
  };
}

async function main(){
  // node_modules解決（@block65/webcrypto-web-push）が効くよう、一時ファイルは
  // push-server/ の中に置く（拡張子.mjsだけで package.json の "type":"commonjs"
  // を上書きできる）。
  const pushServerDir = "C:\\Users\\hirom\\Claude\\LifeCore\\push-server";
  const srcPath = path.join(pushServerDir, "worker.js");
  const src = fs.readFileSync(srcPath, "utf8");
  const tmp = path.join(pushServerDir, ".worker-test-tmp-" + Date.now() + ".mjs");
  fs.writeFileSync(tmp, src, "utf8");
  const mod = await import(pathToFileURL(tmp).href);
  fs.unlinkSync(tmp);
  const { checkAndSendDueTasks } = mod;

  // JST 12:00 を基準時刻にする（UTC 03:00 + 9h = JST 12:00）
  const jstNoonUtcMs = Date.UTC(2026, 8, 28, 3, 0, 0);   // 2026-09-28 12:00 JST
  const today = "2026-09-28";

  // -------- Test 1: 時刻前のタスクは送らない・sentにも入れない（次回また判定できる） --------
  {
    const env = { SUBS: mkKvMock({
      digest: JSON.stringify({ date: today, tasks: [ { id:"future", name:"未来のタスク", time:"12:30" } ] }),
    }) };
    const sent = [];
    await checkAndSendDueTasks(env, jstNoonUtcMs, async (env, body) => sent.push(body));
    ok("a task whose time hasn't arrived yet is not sent", sent.length === 0);
    ok("a task whose time hasn't arrived yet is not marked sent", !env.SUBS._puts.some(p => p.key.startsWith("sent:")));
  }

  // -------- Test 2: 時刻が来たタスクは名前入りの本文で送られ、sentに記録される --------
  {
    const env = { SUBS: mkKvMock({
      digest: JSON.stringify({ date: today, tasks: [ { id:"due1", name:"歯医者", time:"12:00" } ] }),
    }) };
    const sent = [];
    await checkAndSendDueTasks(env, jstNoonUtcMs, async (env, body) => sent.push(body));
    ok("a task exactly at the due time is sent", sent.length === 1 && sent[0] === "歯医者 の時間です");
    const sentPut = env.SUBS._puts.find(p => p.key === "sent:" + today);
    ok("the task is recorded in the sent-set as id+time", !!sentPut && JSON.parse(sentPut.value).includes("due1:12:00"));
    ok("the sent-set is stored with a 2-day TTL", sentPut.opts && sentPut.opts.expirationTtl === 60*60*24*2);
  }

  // -------- Test 3: 猶予時間(15分)以内に見逃した分は送るが、超えた分は送らず、両方ともsent扱いにする --------
  {
    const env = { SUBS: mkKvMock({
      digest: JSON.stringify({ date: today, tasks: [
        { id:"within-grace", name:"少し前のタスク", time:"11:50" },   // 10分前 → 送る
        { id:"stale", name:"だいぶ前のタスク", time:"11:00" },        // 60分前 → 送らないがsentにはする
      ] }),
    }) };
    const sent = [];
    await checkAndSendDueTasks(env, jstNoonUtcMs, async (env, body) => sent.push(body));
    ok("a task within the grace window is still sent", sent.includes("少し前のタスク の時間です"));
    ok("a task well past the grace window is not sent", !sent.includes("だいぶ前のタスク の時間です"));
    const sentPut = env.SUBS._puts.find(p => p.key === "sent:" + today);
    const sentIds = JSON.parse(sentPut.value);
    ok("both the within-grace and stale tasks are recorded as sent (so neither is re-checked forever)", sentIds.includes("within-grace:11:50") && sentIds.includes("stale:11:00"));
  }

  // -------- Test 4: 既にsent済みのタスク（同じ時刻のまま）は、時刻条件を
  // 満たしていても再送しない --------
  {
    const env = { SUBS: mkKvMock({
      digest: JSON.stringify({ date: today, tasks: [ { id:"already", name:"既に通知済み", time:"12:00" } ] }),
      ["sent:" + today]: JSON.stringify(["already:12:00"]),
    }) };
    const sent = [];
    await checkAndSendDueTasks(env, jstNoonUtcMs, async (env, body) => sent.push(body));
    ok("an already-sent task (same time) is not sent again", sent.length === 0);
  }

  // -------- Test 4b: 一度通知が鳴った後にタスクの時刻を編集して後ろにずらすと、
  // 新しい時刻でまた通知される（id単独ではなくid+時刻で「送信済み」を管理して
  // いるため）。ユーザーからの質問「一度通知が鳴ってしまったら、そのタスクを
  // 編集して時間を後にしてももうならない？」への対応。 --------
  {
    const env = { SUBS: mkKvMock({
      // 09:00に既に送信済みだったタスクを、12:00に編集してやり直した状態を再現
      digest: JSON.stringify({ date: today, tasks: [ { id:"rescheduled", name:"延期したタスク", time:"12:00" } ] }),
      ["sent:" + today]: JSON.stringify(["rescheduled:09:00"]),
    }) };
    const sent = [];
    await checkAndSendDueTasks(env, jstNoonUtcMs, async (env, body) => sent.push(body));
    ok("rescheduling an already-notified task to a later time fires a fresh notification", sent.length === 1 && sent[0] === "延期したタスク の時間です");
    const sentPut = env.SUBS._puts.find(p => p.key === "sent:" + today);
    const sentIds = JSON.parse(sentPut.value);
    ok("the sent-set now tracks the new time (old 09:00 entry is superseded)", sentIds.includes("rescheduled:12:00"));
  }

  // -------- Test 4c: LifeCoreの「スケジュール日は深夜4時始まり」規約
  // ——0時〜3時台のタスクは、深夜4時までは前日のスケジュール日の続きとして
  // 扱われる。実際に見つかった不具合: これを考慮せずに暦日で日付を比較・
  // 素の時刻同士で比較していたため、深夜0〜3時台のタスクをその日の日中に
  // 同期すると「とっくに過ぎている」と誤判定され、二度と通知されなかった。
  {
    // シナリオA: スケジュール日"2026-09-29"に01:30のタスクがあり、それを
    // 同じ暦日の日中（14:00）に同期した状態。素の時刻比較だと
    // taskMin=90, nowMin=840 で750分も過ぎている扱いになってしまうが、
    // 本来は深夜4時までまだ来ていないはずなので送ってはいけない。
    const jst1400UtcMs = Date.UTC(2026, 8, 29, 5, 0, 0);   // 2026-09-29 14:00 JST
    const env = { SUBS: mkKvMock({
      digest: JSON.stringify({ date: "2026-09-29", tasks: [ { id:"midnight1", name:"深夜の水分補給", time:"01:30" } ] }),
    }) };
    const sent = [];
    await checkAndSendDueTasks(env, jst1400UtcMs, async (env, body) => sent.push(body));
    ok("a 00:00-03:59 task is NOT treated as overdue when checked during the same schedule day's daytime", sent.length === 0);
    ok("a not-yet-due midnight-window task is not marked sent either (so it can still fire later)", !env.SUBS._puts.some(p => p.key.startsWith("sent:")));
  }

  // シナリオB: 同じタスクを、実際にその時刻（翌暦日の01:30、まだ
  // スケジュール日としては"2026-09-29"の続き）に判定すると正しく送られる。
  {
    const jst0130NextDayUtcMs = Date.UTC(2026, 8, 29, 16, 30, 0);   // 2026-09-30 01:30 JST
    const env = { SUBS: mkKvMock({
      digest: JSON.stringify({ date: "2026-09-29", tasks: [ { id:"midnight1", name:"深夜の水分補給", time:"01:30" } ] }),
    }) };
    const sent = [];
    await checkAndSendDueTasks(env, jst0130NextDayUtcMs, async (env, body) => sent.push(body));
    ok("the same 01:30 task fires once real time actually reaches 01:30 the next calendar day", sent.length === 1 && sent[0] === "深夜の水分補給 の時間です");
    const sentPut = env.SUBS._puts.find(p => p.key === "sent:2026-09-29");
    ok("it's recorded under the ORIGINAL schedule date (2026-09-29), not the new calendar date", !!sentPut);
  }

  // -------- Test 5: digestの日付が今日と違う（古い）ときは何もしない --------
  {
    const env = { SUBS: mkKvMock({
      digest: JSON.stringify({ date: "2000-01-01", tasks: [ { id:"old", name:"古いタスク", time:"12:00" } ] }),
    }) };
    const sent = [];
    await checkAndSendDueTasks(env, jstNoonUtcMs, async (env, body) => sent.push(body));
    ok("a digest from a different date is ignored entirely", sent.length === 0 && env.SUBS._puts.length === 0);
  }

  // -------- Test 6: digestが無いときは何もせず静かに終わる（例外を投げない） --------
  {
    const env = { SUBS: mkKvMock({}) };
    let threw = false;
    try{ await checkAndSendDueTasks(env, jstNoonUtcMs, async () => {}); }catch(e){ threw = true; }
    ok("no digest at all does not throw", !threw);
  }

  // -------- Test 7: 複数の時刻指定タスクは、それぞれ独立して個別に送られる --------
  {
    const env = { SUBS: mkKvMock({
      digest: JSON.stringify({ date: today, tasks: [
        { id:"a", name:"タスクA", time:"12:00" },
        { id:"b", name:"タスクB", time:"12:00" },
        { id:"c", name:"タスクC", time:"13:00" },   // まだ時間前
      ] }),
    }) };
    const sent = [];
    await checkAndSendDueTasks(env, jstNoonUtcMs, async (env, body) => sent.push(body));
    ok("each due task gets its own individual notification (not bundled into one)", sent.length === 2 && sent.includes("タスクA の時間です") && sent.includes("タスクB の時間です"));
    ok("a not-yet-due task among them is left alone", !sent.some(s=>s.includes("タスクC")));
  }

  console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAILURES`);
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.log("TEST THREW:", e && e.stack || e); process.exit(1); });
