import { readFileSync } from "fs";
const cov = JSON.parse(readFileSync("coverage/coverage-final.json", "utf8"));
const target = process.argv[2] || "";

const key = Object.keys(cov).find(k => k.replace(/\\/g, "/").includes(target) && !k.includes(".test."));
if (!key) { console.log("NOT FOUND:", target); process.exit(1); }

const f = cov[key];
const stmts = f.s; const stmtMap = f.statementMap;
const uncovered = Object.entries(stmts).filter(([,v]) => v === 0).map(([k]) => stmtMap[k].start.line);
const unique = [...new Set(uncovered)].sort((a,b)=>a-b);
console.log(`File: ${key.replace(/.*[/\\]src[/\\]/, "src/")}`);
console.log(`Uncovered lines (${unique.length}): ${unique.join(", ")}`);
