// Checks the question bank: node scripts/check-questions.js [dir | file.json ...]
// Prints counts per category and difficulty, and builds every option count for every question.
const fs = require('node:fs');
const path = require('node:path');
const { loadQuestions, loadFiles, buildOptions, OPTION_COUNTS, DIFFICULTIES } = require('../questions');

const args = process.argv.slice(2).map(a => path.resolve(a));
let bank;
try {
  if (args.length === 0) bank = loadQuestions(path.join(__dirname, '..', 'questions'));
  else if (args.length === 1 && fs.statSync(args[0]).isDirectory()) bank = loadQuestions(args[0]);
  else bank = loadFiles(args);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

const shuffle = a => {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
};
for (const q of bank) for (const n of OPTION_COUNTS) for (let k = 0; k < 5; k++) buildOptions(q, n, shuffle);

const counts = new Map();
for (const q of bank) {
  if (!counts.has(q.category)) counts.set(q.category, Object.fromEntries(DIFFICULTIES.map(d => [d, 0])));
  counts.get(q.category)[q.difficulty]++;
}
for (const [cat, c] of counts) console.log(`${cat}: ${DIFFICULTIES.map(d => `${d} ${c[d]}`).join(', ')}`);
console.log(`OK: ${bank.length} questions, ${counts.size} categories, option counts ${OPTION_COUNTS.join('/')}`);
