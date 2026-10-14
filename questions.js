// Question bank: loading, validation and per-room option building. No game state here.
const fs = require('node:fs');
const path = require('node:path');

const DIFFICULTIES = ['easy', 'medium', 'hard'];
const OPTION_COUNTS = [4, 6, 8];
const MAX_OPTIONS = Math.max(...OPTION_COUNTS);

// Options like these break once options are shuffled or their number changes.
const META_OPTION = /همه(ٔ|‌ی|ی)?\s*(موارد|گزینه)|هیچ\s*‌?\s*کدام|هر\s*دو\s*(مورد|گزینه)|all of the above|none of the above/i;
const ARABIC_LETTERS = /[يكة]/; // Persian text uses ی and ک
const PERSIAN_DIGITS = /[۰-۹]/;
const LATIN_DIGITS = /[0-9]/;

// Same text up to spacing, ZWNJ, case, Arabic/Persian letter forms and digit script.
function normalize(s) {
  return String(s)
    .replace(/[‌‏‎]/g, '')
    .replace(/ي/g, 'ی').replace(/ك/g, 'ک')
    .replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function script(s) {
  const latin = /[A-Za-z]/.test(s);
  const persian = /[؀-ۿ]/.test(s.replace(/[۰-۹٫٬]/g, ''));
  if (latin && persian) return 'mixed';
  if (latin) return 'latin';
  if (persian) return 'fa';
  return 'other'; // numbers, symbols
}

const isNumber = s => /^[-−+]?[0-9۰-۹]+([.,٫٬/][0-9۰-۹]+)*$/.test(String(s).trim());

// Returns a list of problems with one question; empty means valid.
function questionProblems(q) {
  const problems = [];
  const bad = msg => problems.push(msg);
  if (!q || typeof q !== 'object') return ['not an object'];
  if (!q.id || typeof q.id !== 'string') bad('missing id');
  if (!q.category || typeof q.category !== 'string') bad('missing category');
  if (!q.question || typeof q.question !== 'string') bad('missing question');
  if (!DIFFICULTIES.includes(q.difficulty)) bad(`bad difficulty "${q.difficulty}"`);
  if (typeof q.answer !== 'string' || !q.answer.trim()) bad('answer must be a non-empty string');
  if (!Array.isArray(q.distractors) || q.distractors.length < MAX_OPTIONS - 1) {
    bad(`needs at least ${MAX_OPTIONS - 1} distractors`);
  }
  if (problems.length) return problems;

  const options = [q.answer, ...q.distractors];
  if (options.some(o => typeof o !== 'string' || !o.trim())) return ['empty or non-string option'];

  const seen = new Map();
  for (const o of options) {
    const key = normalize(o);
    if (seen.has(key)) bad(`duplicate option "${o}" (same as "${seen.get(key)}")`);
    seen.set(key, o);
  }
  for (const o of options) if (META_OPTION.test(o)) bad(`meta option "${o}" breaks when options are shuffled`);
  for (const text of [q.question, q.explanation || '', ...options]) {
    if (ARABIC_LETTERS.test(text)) bad(`Arabic ي/ك/ة instead of Persian letters in "${text.slice(0, 40)}"`);
  }

  // The correct option must not stand out by its form alone.
  if (isNumber(q.answer) && !q.distractors.every(isNumber)) bad('answer is a number but some distractors are not');
  if (!isNumber(q.answer) && q.distractors.some(isNumber)) bad('distractor is a bare number but the answer is not');
  if (options.some(o => PERSIAN_DIGITS.test(o)) && options.some(o => LATIN_DIGITS.test(o))) {
    bad('options mix Persian and Latin digits');
  }
  const answerScript = script(q.answer);
  if (answerScript !== 'mixed' && q.distractors.filter(d => script(d) === answerScript).length < 3) {
    bad(`answer is written in ${answerScript} script but few distractors are`);
  }
  const lengths = q.distractors.map(d => d.trim().length);
  const len = q.answer.trim().length;
  if (len > Math.max(...lengths) * 1.5 + 4) bad('answer is much longer than every distractor');
  if (len * 1.5 + 4 < Math.min(...lengths)) bad('answer is much shorter than every distractor');
  return problems;
}

// Every *.json file in dir is an array of questions; files load in name order.
function loadQuestions(dir) {
  return loadFiles(fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort().map(f => path.join(dir, f)));
}

// Throws one error listing every invalid question, so a broken bank never starts.
function loadFiles(files) {
  const all = [];
  const ids = new Set();
  const errors = [];
  for (const filePath of files) {
    const file = path.basename(filePath);
    let list;
    try {
      list = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (err) {
      errors.push(`${file}: ${err.message}`);
      continue;
    }
    if (!Array.isArray(list)) {
      errors.push(`${file}: must contain a JSON array`);
      continue;
    }
    for (const q of list) {
      const problems = questionProblems(q);
      if (q && q.id && ids.has(q.id)) problems.push('duplicate id');
      if (problems.length) errors.push(...problems.map(p => `${file}: ${q && q.id}: ${p}`));
      else {
        ids.add(q.id);
        all.push(q);
      }
    }
  }

  return all;
}

// Picks `count` options for one question: the correct answer, the strongest half of the
// distractors (they are listed most plausible first) and a random pick of the rest.
// So 4 options stay hard while repeated races still see different distractors.
function buildOptions(q, count, shuffle) {
  if (!OPTION_COUNTS.includes(count)) throw new Error(`Unsupported option count ${count}`);
  const need = count - 1;
  const keep = Math.ceil(need / 2);
  const distractors = [...q.distractors.slice(0, keep), ...shuffle(q.distractors.slice(keep)).slice(0, need - keep)];
  const options = shuffle([q.answer, ...distractors]);
  const answer = options.indexOf(q.answer);
  const keys = new Set(options.map(normalize));
  if (options.length !== count || keys.size !== count || answer < 0 || options.lastIndexOf(q.answer) !== answer) {
    throw new Error(`Question ${q.id}: could not build ${count} unique options`);
  }
  return { options, answer };
}

module.exports = { DIFFICULTIES, OPTION_COUNTS, loadQuestions, loadFiles, questionProblems, buildOptions, normalize };
