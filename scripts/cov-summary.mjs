import { readFileSync } from "node:fs";
const d = JSON.parse(readFileSync("./coverage/coverage-summary.json", "utf8"));
const t = d.total;
console.log("=== TOTAL ===");
console.log(`Lines: ${t.lines.pct}% | Stmts: ${t.statements.pct}% | Fns: ${t.functions.pct}% | Branch: ${t.branches.pct}%`);
console.log();

const dirs = {};
for (const [k, v] of Object.entries(d)) {
  if (k === "total") continue;
  const m = k.replace(/\\/g, "/").match(/src\/([^/]+)/);
  if (!m) continue;
  const dir = m[1];
  if (!dirs[dir]) dirs[dir] = { l: 0, lt: 0 };
  dirs[dir].l += v.lines.covered;
  dirs[dir].lt += v.lines.total;
}
console.log("=== BY DIRECTORY (lines, sorted asc) ===");
const sorted = Object.entries(dirs).filter(([, v]) => v.lt > 30).sort((a, b) => (a[1].l / a[1].lt) - (b[1].l / b[1].lt));
for (const [dir, v] of sorted) {
  const pct = ((v.l / v.lt) * 100).toFixed(1);
  console.log(`${dir.padEnd(28)} ${pct}% (${v.l}/${v.lt})`);
}
