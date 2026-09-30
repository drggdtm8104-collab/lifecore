const fs = require("fs");
const html = fs.readFileSync("C:\\Users\\hirom\\Claude\\LifeCore\\app\\index.html", "utf8");

let fail = 0;
function ok(name, cond){
  if(cond){ console.log("PASS", name); } else { console.log("FAIL", name); fail++; }
}

// v3.112 regression guard: .fab and .fab-menu both set an explicit `display`
// in their base rule, which (per how [hidden] is implemented as a normal-
// priority user-agent rule) means the `hidden` attribute alone cannot hide
// them once that base rule matches. An explicit [hidden] override is required
// or closeFab()/FAB.hidden become no-ops visually (the reported "menu won't
// close" bug).
ok(".fab base rule still sets an explicit display (grid)", /\.fab\{[^}]*display:grid/.test(html));
ok(".fab-menu base rule still sets an explicit display (flex)", /\.fab-menu\{[^}]*display:flex/.test(html));
ok("a .fab[hidden] override to display:none exists", /\.fab\[hidden\][^{]*\{[^}]*display:none/.test(html.replace(/\s+/g,"")) || /\.fab\[hidden\],\s*\.fab-menu\[hidden\]\{\s*display:none/.test(html));
ok("a .fab-menu[hidden] override to display:none exists", /\.fab-menu\[hidden\]/.test(html));

// sanity: #toast has no competing display rule, so it never needed this fix —
// confirm that assumption still holds (if someone later adds `display:` to
// #toast, this test should fail and remind them to add a [hidden] override too).
const toastRuleMatch = html.match(/#toast\{([^}]*)\}/);
ok("#toast still has no explicit display: property (so its [hidden] keeps working via the UA default)",
  !!toastRuleMatch && !/display\s*:/.test(toastRuleMatch[1]));

console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAILURES`);
process.exit(fail ? 1 : 0);
