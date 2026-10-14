const test = require('node:test');
const assert = require('node:assert/strict');
const { RoomManager, GameError, COUNTDOWN_MS, REVEAL_MS, HOST_GRACE_MS } = require('../game');

const q = (id, category, difficulty, extra = {}) => ({
  id, category, difficulty, question: `q-${id}`, answer: `right-${id}`,
  distractors: ['w1', 'w2', 'w3', 'w4', 'w5', 'w6', 'w7'].map(w => `${w}-${id}`), ...extra,
});
const bank = [
  q('e1', 'Programming', 'easy'),
  q('e2', 'Programming', 'easy'),
  q('m1', 'Programming', 'medium', { explanation: 'x' }),
  q('h1', 'Programming', 'hard'),
  q('o1', 'Other', 'easy'),
];

// rng that always returns 0 -> deterministic shuffles
const mgr = () => new RoomManager(bank, { rng: () => 0 });
const opts = (o = {}) => ({ nickname: 'Host', category: 'Programming', difficulty: 'easy', count: 2, seconds: 10, ...o });

function setup(extra = {}) {
  const m = mgr();
  const { code, playerId: host } = m.createRoom(opts(extra), 0);
  const { playerId: p2 } = m.joinRoom(code, 'Bob', 0);
  m.setConnected(code, host, true, 0);
  m.setConnected(code, p2, true, 0);
  return { m, code, host, p2 };
}

// Advance from start through the countdown into the first question.
function startRace({ m, code, host }, t = 0) {
  m.start(code, host, t);
  m.tick(t + COUNTDOWN_MS);
  return t + COUNTDOWN_MS;
}

const correctIndex = (m, code) => m._room(code).questions[m._room(code).index].answer;

test('categories lists counts per difficulty', () => {
  const cats = mgr().categories();
  assert.deepEqual(cats.find(c => c.name === 'Programming').counts, { easy: 2, medium: 1, hard: 1 });
  assert.ok(cats.find(c => c.name === 'Other'));
});

test('createRoom validates input', () => {
  const m = mgr();
  assert.throws(() => m.createRoom(opts({ nickname: '  ' }), 0), GameError);
  assert.throws(() => m.createRoom(opts({ category: 'Nope' }), 0), GameError);
  assert.throws(() => m.createRoom(opts({ difficulty: 'insane' }), 0), GameError);
  assert.throws(() => m.createRoom(opts({ category: 'Other', difficulty: 'hard' }), 0), /سؤالی وجود ندارد/);
  assert.throws(() => m.createRoom(opts({ optionCount: 5 }), 0), /۴، ۶ یا ۸/);
});

test('join rules: unique names, unknown room, closed after start', () => {
  const ctx = setup();
  const { m, code } = ctx;
  assert.throws(() => m.joinRoom(code, 'bob', 0), /گرفته شده/);
  assert.throws(() => m.joinRoom('ZZZZ', 'Al', 0), e => e.status === 404);
  startRace(ctx);
  assert.throws(() => m.joinRoom(code, 'Late', 0), /شروع شده/);
});

test('only host can start', () => {
  const { m, code, p2 } = setup();
  assert.throws(() => m.start(code, p2, 0), e => e.status === 403);
});

test('pool smaller than count uses whole pool', () => {
  const { m, code } = setup({ difficulty: 'medium', count: 10 });
  assert.equal(m._room(code).questions.length, 1);
});

test('mixed difficulty draws from all levels of the category', () => {
  const { m, code } = setup({ difficulty: 'mixed', count: 10 });
  assert.equal(m._room(code).questions.length, 4);
});

test('options are shuffled but answer index stays correct', () => {
  const m = new RoomManager(bank, { rng: () => 0.99 });
  const { code } = m.createRoom(opts({ difficulty: 'hard' }), 0);
  const picked = m._room(code).questions[0];
  assert.equal(picked.options[picked.answer], 'right-h1');
});

test('countdown then question; correct answer hidden during question', () => {
  const ctx = setup();
  const { m, code, host } = ctx;
  m.start(code, host, 0);
  assert.equal(m.publicState(code, host, 0).phase, 'countdown');
  const t = COUNTDOWN_MS;
  m.tick(t);
  const s = m.publicState(code, host, t);
  assert.equal(s.phase, 'question');
  assert.equal(s.question.index, 0);
  assert.equal(s.question.answer, undefined);
  assert.equal(s.reveal, null);
  assert.ok(!JSON.stringify(s).includes('"answer"'));
});

test('scoring rewards speed; wrong answer scores 0', () => {
  const ctx = setup();
  const { m, code, host, p2 } = ctx;
  const t = startRace(ctx);
  const right = correctIndex(m, code);
  m.answer(code, host, right, t);            // instant -> 1000
  m.answer(code, p2, (right + 1) % 4, t + 1000);
  const s = m.publicState(code, host, t + 1000);
  assert.equal(s.phase, 'reveal');
  assert.equal(s.reveal.answer, right);
  const byName = Object.fromEntries(s.players.map(p => [p.name, p]));
  assert.equal(byName.Host.score, 1000);
  assert.equal(byName.Bob.score, 0);
  assert.equal(byName.Bob.lastCorrect, false);
});

test('half time remaining scores 750', () => {
  const ctx = setup();
  const { m, code, host } = ctx;
  const t = startRace(ctx);
  m.answer(code, host, correctIndex(m, code), t + 5000);
  assert.equal(m._room(code).players.get(host).score, 750);
});

test('one answer per question, unknown player and late answers rejected', () => {
  const ctx = setup();
  const { m, code, host } = ctx;
  const t = startRace(ctx);
  m.answer(code, host, 0, t);
  assert.throws(() => m.answer(code, host, 1, t), /قبلاً پاسخ/);
  assert.throws(() => m.answer(code, 'nobody', 0, t), e => e.status === 403);
  assert.throws(() => m.answer(code, ctx.p2, 9, t), /نامعتبر/);
  assert.throws(() => m.answer(code, ctx.p2, 0, t + 10_001), /وقت تمام شد/);
});

test('timeout moves to reveal, then next question, then final', () => {
  const ctx = setup();
  const { m, code, host } = ctx;
  let t = startRace(ctx);
  t += 10_000; m.tick(t);
  assert.equal(m.publicState(code, host, t).phase, 'reveal');
  t += REVEAL_MS; m.tick(t);
  let s = m.publicState(code, host, t);
  assert.equal(s.phase, 'question');
  assert.equal(s.question.index, 1);
  t += 10_000; m.tick(t);
  t += REVEAL_MS; m.tick(t);
  s = m.publicState(code, host, t);
  assert.equal(s.phase, 'final');
  assert.ok(s.reveal === null);
});

test('disconnected players do not block early reveal', () => {
  const ctx = setup();
  const { m, code, host, p2 } = ctx;
  const t = startRace(ctx);
  m.setConnected(code, p2, false, t);
  m.answer(code, host, 0, t + 100);
  assert.equal(m.publicState(code, host, t + 100).phase, 'reveal');
});

test('reconnect keeps score and answered state', () => {
  const ctx = setup();
  const { m, code, host, p2 } = ctx;
  const t = startRace(ctx);
  m.answer(code, p2, correctIndex(m, code), t);
  m.setConnected(code, p2, false, t + 10);
  m.setConnected(code, p2, true, t + 20);
  const me = m.publicState(code, p2, t + 20);
  assert.equal(me.myAnswer, correctIndex(m, code));
  assert.equal(m._room(code).players.get(p2).score, 1000);
});

test('ranking ties broken by faster total correct time', () => {
  const ctx = setup({ count: 1 });
  const { m, code, host, p2 } = ctx;
  const t = startRace(ctx);
  // both correct; scores equal only if same remaining time -> force same score but different time
  m._room(code).players.get(host).score = 500; m._room(code).players.get(host).correctMs = 9000;
  m._room(code).players.get(p2).score = 500; m._room(code).players.get(p2).correctMs = 3000;
  const s = m.publicState(code, host, t);
  assert.equal(s.players[0].name, 'Bob');
});

test('host handover after grace period', () => {
  const { m, code, host, p2 } = setup();
  m.setConnected(code, host, false, 1000);
  m.tick(1000 + HOST_GRACE_MS - 1);
  assert.equal(m._room(code).hostId, host);
  m.setConnected(code, host, true, 1500); // quick refresh keeps host
  m.tick(1000 + HOST_GRACE_MS + 1);
  assert.equal(m._room(code).hostId, host);
  m.setConnected(code, host, false, 2000);
  const { changed } = m.tick(2000 + HOST_GRACE_MS + 1);
  assert.equal(m._room(code).hostId, p2);
  assert.ok(changed.includes(code));
});

test('restart returns to countdown with scores reset; host only, final only', () => {
  const ctx = setup({ count: 1 });
  const { m, code, host, p2 } = ctx;
  let t = startRace(ctx);
  assert.throws(() => m.restart(code, host, t), /تمام نشده/);
  m.answer(code, host, correctIndex(m, code), t);
  m.answer(code, p2, correctIndex(m, code), t);
  t += REVEAL_MS; m.tick(t);
  assert.equal(m.publicState(code, host, t).phase, 'final');
  assert.throws(() => m.restart(code, p2, t), e => e.status === 403);
  m.restart(code, host, t);
  const s = m.publicState(code, host, t);
  assert.equal(s.phase, 'countdown');
  assert.ok(s.players.every(p => p.score === 0));
});

test('idle rooms with nobody connected are removed', () => {
  const { m, code, host, p2 } = setup();
  m.setConnected(code, host, false, 0);
  m.setConnected(code, p2, false, 0);
  const { removed } = m.tick(31 * 60_000);
  assert.deepEqual(removed, [code]);
  assert.equal(m.hasPlayer(code, host), false);
});

test('scores of the current question stay hidden until reveal', () => {
  const ctx = setup();
  const { m, code, host, p2 } = ctx;
  const t = startRace(ctx);
  m.answer(code, p2, correctIndex(m, code), t);
  const during = m.publicState(code, host, t);
  assert.equal(during.phase, 'question');
  assert.ok(during.players.every(p => p.score === 0));
  m.answer(code, host, (correctIndex(m, code) + 1) % 4, t);
  assert.equal(m.publicState(code, host, t).players.find(p => p.name === 'Bob').score, 1000);
});

test('mixed category draws from every category', () => {
  const m = mgr();
  const { code } = m.createRoom(opts({ category: 'mixed', difficulty: 'easy', count: 10 }), 0);
  const cats = new Set(m._room(code).questions.map(q => q.category));
  assert.deepEqual([...cats].sort(), ['Other', 'Programming']);
  assert.equal(m._room(code).questions.length, 3);
});

test('mixed category is balanced across categories', () => {
  const m = new RoomManager(bank, { rng: () => 0.99 }); // identity shuffle: unbalanced pick would be e1, e2
  const { code } = m.createRoom(opts({ category: 'mixed', difficulty: 'easy', count: 2 }), 0);
  const cats = m._room(code).questions.map(q => q.category).sort();
  assert.deepEqual(cats, ['Other', 'Programming']);
});

test('every question has exactly the chosen number of unique options and one correct answer', () => {
  for (const optionCount of [4, 6, 8]) {
    for (let seed = 0; seed < 20; seed++) {
      let x = seed + 1;
      const m = new RoomManager(bank, { rng: () => ((x = (x * 16807) % 2147483647) / 2147483647) });
      const { code } = m.createRoom(opts({ category: 'mixed', difficulty: 'mixed', count: 10, optionCount }), 0);
      for (const picked of m._room(code).questions) {
        assert.equal(picked.options.length, optionCount);
        assert.equal(new Set(picked.options).size, optionCount);
        assert.equal(picked.options.filter(o => o.startsWith('right-')).length, 1);
        assert.equal(picked.options[picked.answer], `right-${picked.id}`);
      }
    }
  }
});

test('option count defaults to 4, is exposed in settings and accepted as a string', () => {
  const m = mgr();
  const a = m.createRoom(opts(), 0);
  assert.equal(m.publicState(a.code, a.playerId, 0).settings.optionCount, 4);
  const b = m.createRoom(opts({ optionCount: '8' }), 0);
  assert.equal(m._room(b.code).questions[0].options.length, 8);
});

test('fewer options keep the strongest distractors', () => {
  const m = new RoomManager(bank, { rng: () => 0.5 });
  const { code } = m.createRoom(opts({ difficulty: 'hard', optionCount: 4 }), 0);
  const picked = m._room(code).questions[0];
  assert.ok(picked.options.includes('w1-h1') && picked.options.includes('w2-h1'));
});

test('options are answered with any index up to the option count', () => {
  const ctx = setup({ optionCount: 8 });
  const { m, code, host, p2 } = ctx;
  const t = startRace(ctx);
  m.answer(code, host, 7, t);
  assert.throws(() => m.answer(code, p2, 8, t), /نامعتبر/);
});

test('play again prefers questions the room has not seen yet', () => {
  const big = Array.from({ length: 6 }, (_, i) => q(`b${i}`, 'Big', 'easy'));
  let x = 7;
  const m = new RoomManager(big, { rng: () => ((x = (x * 16807) % 2147483647) / 2147483647) });
  const { code, playerId } = m.createRoom(opts({ category: 'Big', count: 3 }), 0);
  const first = m._room(code).questions.map(p => p.id);
  m._room(code).phase = 'final';
  m.restart(code, playerId, 0);
  const second = m._room(code).questions.map(p => p.id);
  assert.equal(new Set([...first, ...second]).size, 6);
});
