import { readFileSync } from "fs";
const data = JSON.parse(readFileSync("coverage/coverage-summary.json", "utf8"));

const targets = ["web.ts", "diff.ts", "changelog.ts", "shell.ts", "shell-runtime.ts",
  "filesystem.ts", "dynamic.ts", "rss.ts", "database.ts", "git.ts", "docker.ts",
  "diagram.ts", "ai-agent.ts"];

const SHOW_PARTIAL = process.argv.includes("--partial");

if (SHOW_PARTIAL) {
  // Show files with partial coverage (0 < pct < 70) and significant size
  const entries = Object.entries(data)
    .filter(([k]) => k !== "total")
    .map(([k, v]) => ({
      file: k.replace(/\\/g, "/").replace(/.*slack\/next\//i, ""),
      pct: v.lines.pct,
      tot: v.lines.total,
      cov: v.lines.covered,
    }))
    .filter((e) => e.pct > 0 && e.pct < 70 && e.tot > 10)
    .sort((a, b) => b.tot - a.tot);
  console.log(`\nPartially covered files (0-70%, >10 lines) — ${entries.length} files:`);
  entries.slice(0, 20).forEach((e) =>
    console.log(`${String(e.pct.toFixed(1)).padStart(6)}%  ${e.file}  (${e.tot} lines, ${e.cov} covered)`)
  );
} else {
  Object.entries(data).forEach(([k, v]) => {
    const name = k.split(/[/\\]/).pop();
    if (targets.includes(name)) {
      const path = k.replace(/\\/g, "/").replace(/.*src\//, "src/");
      console.log(`${String(v.lines.pct.toFixed(1)).padStart(6)}%  ${path}  (${v.lines.covered}/${v.lines.total})`);
    }
  });
}
