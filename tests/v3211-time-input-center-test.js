const fs = require("fs");
const html = fs.readFileSync("C:\\Users\\hirom\\Claude\\LifeCore\\app\\index.html", "utf8");

let fail = 0;
function ok(name, cond){
  if(cond){ console.log("PASS", name); } else { console.log("FAIL", name); fail++; }
}

// v3.211: 「時刻の枠と実際の数字の位置が少し偏って見える」との指摘。
// .time-stepper-row .ts-input（開始/終了の時刻欄、v3.208〜タップで
// time-wheelを開くトリガー）にtext-alignが無く、ブラウザ既定の左寄せで
// 表示されていたため、82px幅の枠の中で数字が左に寄って見えていた。
// text-align:centerを追加して、枠の中央に数字が来るようにする。
const rule = html.match(/\.time-stepper-row \.ts-input\{([^}]*)\}/);
ok(".time-stepper-row .ts-input rule exists", !!rule);
const body = rule ? rule[1] : "";
ok("the time field's text is centered within its box", /text-align:center/.test(body));
// 幅・パディングなど既存のレイアウトはそのまま保たれていること（v3.209で
// 直したCSS詳細度のバグが再発していないか、ついでに確認する）。
ok("width is still the original 82px", /width:82px/.test(body));
ok("padding is still 0 6px", /padding:0 6px/.test(body));

console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAILURES`);
process.exit(fail ? 1 : 0);
