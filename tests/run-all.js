// Runs every vNNN-test*.js regression test in this folder and prints a summary.
// Exists so the whole suite can be invoked as a single `node ...` command
// (already allow-listed), instead of a multi-line PowerShell pipeline that
// needs its own separate permission rule every time its exact text changes.
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const dir = __dirname;
const files = fs.readdirSync(dir).filter(f => /^v3.*-test.*\.js$/.test(f)).sort();

let failedFiles = [];
for(const f of files){
  const res = spawnSync(process.execPath, [path.join(dir, f)], { encoding: "utf8" });
  const out = (res.stdout || "") + (res.stderr || "");
  if(res.status !== 0){
    failedFiles.push(f);
    console.log(`=== FAIL: ${f} ===`);
    console.log(out);
  }
}

console.log(`TOTAL FAILED FILES: ${failedFiles.length} / ${files.length} run`);
process.exit(failedFiles.length ? 1 : 0);
