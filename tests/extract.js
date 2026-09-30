const fs = require("fs");
const path = require("path");
const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const matches = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)];
if(matches.length === 0){ console.error("no inline <script> found"); process.exit(1); }
// the app logic is the largest inline script block
const biggest = matches.reduce((a,b) => b[1].length > a[1].length ? b : a);
fs.writeFileSync(path.join(__dirname, "app.js"), biggest[1], "utf8");
console.log("extracted", biggest[1].length, "chars to app.js");
