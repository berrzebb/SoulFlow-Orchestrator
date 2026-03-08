import { readFileSync } from "fs";
import { join } from "path";

const data = JSON.parse(readFileSync("coverage/coverage-summary.json", "utf8"));
const cwd = process.cwd().replaceAll("\\", "/");
const files = Object.entries(data)
  .filter(([k]) => k !== "total")
  .map(([file, v]) => ({
    file: file.replace(cwd + "/src/", ""),
    stmts: v.statements.pct,
    uncov: v.statements.total - v.statements.covered,
  }))
  .filter((f) => f.stmts > 0 && f.stmts < 90 && f.uncov > 5)
  .sort((a, b) => b.uncov - a.uncov);

console.log("=== Files 0-90% coverage, >5 uncovered statements ===");
files.slice(0, 30).forEach((f) =>
  console.log(`${f.stmts.toFixed(1)}%\t${f.uncov} uncov\t${f.file}`)
);
