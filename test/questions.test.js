const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadQuestions, questionProblems, buildOptions, normalize, OPTION_COUNTS, DIFFICULTIES } = require('../questions');

const good = {
  id: 'x-e-01', category: 'غذا و آشپزی', difficulty: 'easy',
  question: '«کله‌جوش» با کدام فرآورده‌ی لبنی پخته می‌شود؟',
  answer: 'کشک', distractors: ['دوغ', 'ماست', 'قره‌قوروت', 'سرشیر', 'پنیر محلی', 'خامه', 'کره‌ی حیوانی'],
};
const problems = extra => questionProblems({ ...good, ...extra });

test('a well-formed question has no problems', () => {
  assert.deepEqual(questionProblems(good), []);
});

test('validator rejects structural problems', () => {
  assert.match(problems({ difficulty: 'insane' }).join(), /difficulty/);
  assert.match(problems({ distractors: good.distractors.slice(0, 6) }).join(), /7 distractors/);
  assert.match(problems({ answer: 2 }).join(), /answer/);
});

test('validator rejects duplicates after normalising letters, ZWNJ and spacing', () => {
  assert.match(problems({ distractors: ['کشك', ...good.distractors.slice(1)] }).join(), /duplicate|Arabic/);
  assert.match(problems({ distractors: ['قره قوروت', ...good.distractors] }).join(), /duplicate/);
  assert.equal(normalize('می‌شود'), normalize('میشود'));
  assert.equal(normalize('۱۲'), normalize('12'));
});

test('validator rejects meta options and giveaway answers', () => {
  assert.match(problems({ distractors: ['همه‌ی موارد', ...good.distractors.slice(1)] }).join(), /meta/);
  assert.match(problems({ answer: '۸', distractors: ['۱۲', '۱۰', '۷', '۶', '۹', '۱۱', 'هشت'] }).join(), /number/);
  assert.match(problems({ answer: '۸', distractors: ['۱۲', '۱۰', '۷', '۶', '۹', '۱۱', '14'] }).join(), /digits/);
  assert.match(problems({ answer: 'Kashk', distractors: good.distractors }).join(), /script/);
  assert.match(problems({ answer: 'کشک محلی خانگی که با آب و نمک ساییده و جوشانده شده است' }).join(), /longer/);
});

test('buildOptions rejects unsupported counts', () => {
  assert.throws(() => buildOptions(good, 5, a => a), /Unsupported/);
});

// The real bank: every file, category, difficulty and option count.
const bank = loadQuestions(path.join(__dirname, '..', 'questions'));
let seed = 42;
const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const shuffle = a => {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
};

test('the real bank loads and every category has every difficulty', () => {
  const cats = new Map();
  for (const q of bank) {
    if (!cats.has(q.category)) cats.set(q.category, new Set());
    cats.get(q.category).add(q.difficulty);
  }
  assert.ok(cats.size >= 12, `only ${cats.size} categories`);
  for (const [cat, diffs] of cats) assert.deepEqual([...diffs].sort(), [...DIFFICULTIES].sort(), cat);
});

test('every real question builds 4, 6 and 8 unique options with one correct answer', () => {
  for (const q of bank) {
    for (const n of OPTION_COUNTS) {
      for (let k = 0; k < 10; k++) {
        const { options, answer } = buildOptions(q, n, shuffle);
        assert.equal(options.length, n, q.id);
        assert.equal(new Set(options.map(normalize)).size, n, q.id);
        assert.equal(options.filter(o => o === q.answer).length, 1, q.id);
        assert.equal(options[answer], q.answer, q.id);
      }
    }
  }
});

test('question texts are not repeated', () => {
  const seen = new Map();
  for (const q of bank) {
    const key = normalize(q.question);
    assert.ok(!seen.has(key), `${q.id} repeats ${seen.get(key)}`);
    seen.set(key, q.id);
  }
});
