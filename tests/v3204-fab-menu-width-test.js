const fs = require("fs");
const html = fs.readFileSync("C:\\Users\\hirom\\Claude\\LifeCore\\app\\index.html", "utf8");

let fail = 0;
function ok(name, cond){
  if(cond){ console.log("PASS", name); } else { console.log("FAIL", name); fail++; }
}

// v3.204: スケジュールタブの＋ボタン（openFab）で出る「ToDoリストに追加」
// 「予定を追加」「ひと段落」の3つのボタンは、文言の長さがそれぞれ違うため
// 幅がバラバラだった（align-items:flex-endで右端は揃うが左端が揃わない）。
// 一番長い「ToDoリストに追加」の実測幅(130.2px)+余白で幅を固定し、
// 全ボタンの横幅を揃えた。
const rule = html.match(/\.fab-menu button\{([^}]*)\}/);
ok(".fab-menu button rule exists", !!rule);
const body = rule ? rule[1] : "";

ok(".fab-menu button has a fixed width (not sized to its own text)", /width:\s*1[23]\dpx/.test(body));
ok(".fab-menu button centers its label (text-align:center)", /text-align:center/.test(body));
ok(".fab-menu button truncates safely if a future label is longer (ellipsis)", /text-overflow:ellipsis/.test(body) && /white-space:nowrap/.test(body) && /overflow:hidden/.test(body));

// the three buttons openFab() actually renders, unchanged by this fix
ok("openFab() still renders the three expected menu items", (() => {
  const m = html.match(/function openFab\(\)\{([\s\S]*?)\n\}/);
  if(!m) return false;
  const src = m[1];
  return /ToDoリストに追加/.test(src) && /予定を追加/.test(src) && /ひと段落/.test(src);
})());

console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAILURES`);
process.exit(fail ? 1 : 0);
