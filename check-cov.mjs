import { readFileSync } from 'fs';
const raw = readFileSync('D:/claude-tools/.claude/mcp-servers/slack/next/coverage/coverage-summary.json', 'utf8');
const data = JSON.parse(raw);
const results = [];
for (const [file, stats] of Object.entries(data)) {
  if (file === 'total') continue;
  if (!file.includes('\\src\\')) continue;
  const idx = file.lastIndexOf('\\src\\');
  const rel = file.slice(idx + 5);
  const pct = stats.lines.pct;
  const uncovered = stats.lines.total - stats.lines.covered;
  if (pct >= 85 && pct < 100 && uncovered >= 1) {
    results.push({ rel, pct, uncovered });
  }
}
results.sort((a, b) => b.pct - a.pct);
for (const r of results.slice(0, 40)) {
  console.log(r.pct.toFixed(1).padStart(5) + '%  ' + r.uncovered.toString().padStart(4) + '  ' + r.rel);
}
