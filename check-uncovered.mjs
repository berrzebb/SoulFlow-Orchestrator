import { readFileSync } from 'fs';
const cov = JSON.parse(readFileSync('coverage/coverage-final.json', 'utf8'));
const patterns = process.argv.slice(2);

for (const pat of patterns) {
  const key = Object.keys(cov).find(k => k.replace(/\\/g, '/').endsWith(pat) || k.replace(/\\/g, '/').includes(pat));
  if (!key) { console.log('NOT FOUND:', pat); continue; }
  const f = cov[key];
  const lines = new Set();
  for (const [id, count] of Object.entries(f.s)) {
    if (count === 0) lines.add(f.statementMap[id].start.line);
  }
  console.log(pat + ': [' + [...lines].sort((a,b)=>a-b).join(', ') + ']');
}
