import { readFileSync } from 'fs';
const data = JSON.parse(readFileSync('coverage/coverage-summary.json', 'utf8'));
const total = data.total;
console.log('\n=== TOTAL COVERAGE ===');
console.log(`Statements: ${total.statements.pct}%  (${total.statements.covered}/${total.statements.total})`);
console.log(`Lines:      ${total.lines.pct}%  (${total.lines.covered}/${total.lines.total})`);
console.log(`Functions:  ${total.functions.pct}%  (${total.functions.covered}/${total.functions.total})`);
console.log(`Branches:   ${total.branches.pct}%  (${total.branches.covered}/${total.branches.total})`);

const THRESHOLD = parseFloat(process.argv[2] || '70');
const files = Object.entries(data)
  .filter(([k]) => k !== 'total')
  .map(([k, v]) => ({ file: k.replace(/\\/g, '/').replace(/.*slack\/next\//i, ''), lines: v.lines.pct, cov: v.lines.covered, tot: v.lines.total }))
  .filter(f => f.lines < THRESHOLD)
  .sort((a, b) => a.lines - b.lines);
console.log(`\n=== FILES BELOW ${THRESHOLD}% (${files.length} files) ===`);
files.slice(0, 50).forEach(f => console.log(String(f.lines.toFixed(1)).padStart(6) + '%  ' + f.file + '  (' + f.cov + '/' + f.tot + ')'));
