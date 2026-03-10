import { readFileSync } from 'fs';
const raw = readFileSync('D:/claude-tools/.claude/mcp-servers/slack/next/coverage/coverage-summary.json', 'utf8');
const data = JSON.parse(raw);
const results = [];
for (const [k, v] of Object.entries(data)) {
  if (k === 'total') continue;
  if (!k.includes('slack\\next\\src\\')) continue;
  const rel = k.split('slack\\next\\src\\')[1];
  const pct = v.lines.pct;
  const uncovered = v.lines.total - v.lines.covered;
  if (pct >= 70 && pct < 100 && uncovered >= 1) {
    results.push({ rel, pct, uncovered });
  }
}
results.sort((a, b) => b.pct - a.pct);
for (const r of results.slice(0, 60)) {
  console.log(r.pct.toFixed(1).padStart(5) + '%  ' + r.uncovered.toString().padStart(5) + '  ' + r.rel);
}
