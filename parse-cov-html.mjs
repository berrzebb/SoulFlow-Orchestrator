/**
 * Parse Istanbul-style coverage HTML and extract uncovered line numbers.
 * Structure: 3 <td>s per row — line-count (all line #s), line-coverage (all spans), text (code)
 */
import { readFileSync } from 'fs';

const file = process.argv[2];
const html = readFileSync(file, 'utf8');

// Extract the line-coverage <td> content
const covTdMatch = html.match(/<td class="line-coverage[^"]*">([\s\S]*?)<\/td>/);
if (!covTdMatch) { console.log('No line-coverage td found'); process.exit(1); }
const covContent = covTdMatch[1];

// Split by newline and count positions (each line = one source line)
const spans = covContent.split('\n');
const uncovered = [];
let lineNum = 1;
for (const span of spans) {
  if (span.trim() === '') { lineNum++; continue; }
  if (span.includes('cline-no')) {
    uncovered.push(lineNum);
  }
  lineNum++;
}

console.log('Uncovered lines:', uncovered.sort((a,b) => a-b).join(', '));
