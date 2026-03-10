import { readFileSync } from 'fs';
const d = JSON.parse(readFileSync('coverage/coverage-summary.json', 'utf8'));
const files = Object.entries(d)
  .filter(([k]) => k !== 'total')
  .map(([k, v]) => ({ file: k.replace(/.*slack.next./i, '').replace(/\\/g, '/'), lines: v.lines.pct, cov: v.lines.covered, tot: v.lines.total }))
  .filter(f => f.lines > 1 && f.lines < 90 && f.tot > 5)
  .sort((a, b) => a.lines - b.lines);
files.slice(0, 40).forEach(f => console.log(f.lines.toFixed(1).padStart(6) + '%  ' + f.file + '  (' + f.cov + '/' + f.tot + ')'));
