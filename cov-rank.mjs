import { readFileSync } from "fs";
const cov = JSON.parse(readFileSync("coverage/coverage-final.json", "utf8"));

const results = [];
for (const [file, data] of Object.entries(cov)) {
  if (file.includes(".test.") || file.includes("node_modules")) continue;
  const stmts = Object.values(data.s);
  const total = stmts.length;
  const covered = stmts.filter(v => v > 0).length;
  const pct = total > 0 ? Math.round((covered / total) * 100) : 100;
  const uncovered = total - covered;
  const shortPath = file.replace(/.*[/\\]src[/\\]/, "src/");
  results.push({ shortPath, pct, covered, total, uncovered });
}

// Sort by pct asc, then uncovered desc
results.sort((a, b) => a.pct - b.pct || b.uncovered - a.uncovered);

const args = process.argv.slice(2);
const showAll = args.includes("--all");
const minPct = parseInt(args.find(a => a.startsWith("--min="))?.replace("--min=","") ?? "0");

console.log("Pct | Uncov | Total | File");
console.log("----+-------+-------+-----");
const filtered = results.filter(r => r.pct >= minPct && (showAll || r.total >= 20));
for (const r of (showAll ? filtered : filtered.slice(0, 50))) {
  console.log(`${String(r.pct).padStart(3)}%| ${String(r.uncovered).padStart(5)} | ${String(r.total).padStart(5)} | ${r.shortPath}`);
}
console.log(`\nTotal files: ${filtered.length}`);
