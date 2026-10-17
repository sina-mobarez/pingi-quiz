const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Accounts } = require('../accounts');

test('register validates username and password', () => {
  const a = new Accounts();
  assert.throws(() => a.register('ab', 'secret1'), /نام کاربری/);
  assert.throws(() => a.register('bad name', 'secret1'), /نام کاربری/);
  assert.throws(() => a.register('sina', '123'), /رمز عبور/);
  assert.ok(a.register('سینا_۱', 'secret1').token);
  assert.throws(() => a.register('سینا_۱', 'other12'), e => e.status === 409);
  a.register('Sina', 'secret1');
  assert.throws(() => a.register(' SINA ', 'other12'), e => e.status === 409);
});

test('login checks the password and sessions resolve to the user', () => {
  const a = new Accounts();
  const { token } = a.register('Sina', 'secret1');
  assert.equal(a.userFor(token).username, 'Sina');
  assert.throws(() => a.login('sina', 'wrong!!'), e => e.status === 401);
  assert.throws(() => a.login('nobody', 'secret1'), e => e.status === 401);
  const second = a.login('SINA', 'secret1');
  assert.equal(a.userFor(second.token).username, 'Sina');
  a.logout(token);
  assert.equal(a.userFor(token), null);
  assert.throws(() => a.requireUser(token), e => e.status === 401);
  assert.equal(a.userFor(second.token).username, 'Sina');
});

test('passwords and tokens are never stored in plain text', () => {
  const a = new Accounts();
  const { token } = a.register('Sina', 'secret1');
  const raw = JSON.stringify(a.data);
  assert.ok(!raw.includes('secret1'));
  assert.ok(!raw.includes(token));
});

test('recordGame updates stats; wins need another player', () => {
  const a = new Accounts();
  a.register('Ali', 'secret1');
  a.register('Bob', 'secret1');
  a.recordGame([{ name: 'Ali', score: 1500, correctCount: 2, total: 3, rank: 1 }]);
  a.recordGame([
    { name: 'ali', score: 800, correctCount: 1, total: 2, rank: 1 },
    { name: 'Bob', score: 0, correctCount: 0, total: 2, rank: 2 },
  ]);
  const ali = a.profile(a.userFor(a.login('Ali', 'secret1').token));
  assert.deepEqual(ali, {
    username: 'Ali', games: 2, wins: 1, score: 2300, best: 1500, rating: 1016, bestStreak: 0, accuracy: 60,
  });
});

test('leaderboard ranks by rating, best first and worst first', () => {
  const a = new Accounts();
  for (const n of ['Ali', 'Bob', 'Cyrus', 'Idle']) a.register(n, 'secret1');
  a.recordGame([
    { name: 'Bob', score: 900, correctCount: 1, total: 1, rank: 1 },
    { name: 'Ali', score: 500, correctCount: 1, total: 1, rank: 2 },
    { name: 'Cyrus', score: 0, correctCount: 0, total: 1, rank: 3 },
  ]);
  const board = a.leaderboard(2);
  assert.equal(board.total, 3);
  assert.deepEqual(board.best.map(p => [p.rank, p.username]), [[1, 'Bob'], [2, 'Ali']]);
  assert.deepEqual(board.worst.map(p => [p.rank, p.username]), [[3, 'Cyrus'], [2, 'Ali']]);
  // Lots of solo points don't beat a higher rating.
  a.recordGame([{ name: 'Cyrus', score: 9000, correctCount: 9, total: 9, rank: 1 }]);
  assert.deepEqual(a.leaderboard().best.map(p => p.username), ['Bob', 'Ali', 'Cyrus']);
});

test('accounts persist to disk', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'quiz-')), 'users.json');
  const { token } = new Accounts(file).register('Sina', 'secret1');
  const reloaded = new Accounts(file);
  assert.equal(reloaded.userFor(token).username, 'Sina');
  assert.ok(reloaded.login('sina', 'secret1').token);
});

test('ratings move only in multiplayer games, winner up, loser down by the same amount', () => {
  const a = new Accounts();
  for (const n of ['Ali', 'Bob', 'Cyrus']) a.register(n, 'secret1');
  assert.deepEqual(a.recordGame([{ name: 'Ali', score: 900, correctCount: 1, total: 1, rank: 1 }]), {});
  const changes = a.recordGame([
    { name: 'Ali', score: 900, correctCount: 1, total: 1, rank: 1 },
    { name: 'Bob', score: 0, correctCount: 0, total: 1, rank: 2 },
  ]);
  assert.deepEqual(changes, { Ali: { rating: 1016, delta: 16 }, Bob: { rating: 984, delta: -16 } });
  // Beating a stronger player is worth more than beating a weaker one.
  const upset = a.recordGame([
    { name: 'Bob', score: 900, correctCount: 1, total: 1, rank: 1 },
    { name: 'Ali', score: 0, correctCount: 0, total: 1, rank: 2 },
  ]);
  assert.ok(upset.Bob.delta > 16);
  // A three-way race with a tie at the bottom.
  const three = a.recordGame([
    { name: 'Cyrus', score: 900, correctCount: 1, total: 1, rank: 1 },
    { name: 'Ali', score: 0, correctCount: 0, total: 1, rank: 2 },
    { name: 'Bob', score: 0, correctCount: 0, total: 1, rank: 3 },
  ]);
  assert.ok(three.Cyrus.delta > 0 && three.Ali.delta < 0 && three.Bob.delta < 0);
});

test('best streak is kept and old accounts get default rating', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'quiz-')), 'users.json');
  const a = new Accounts(file);
  a.register('Ali', 'secret1');
  a.recordGame([{ name: 'Ali', score: 900, correctCount: 1, total: 1, rank: 1, bestStreak: 4 }]);
  a.recordGame([{ name: 'Ali', score: 900, correctCount: 1, total: 1, rank: 1, bestStreak: 2 }]);
  delete a.data.users.ali.stats.rating;
  a._save();
  const ali = new Accounts(file).leaderboard().best[0];
  assert.equal(ali.bestStreak, 4);
  assert.equal(ali.rating, 1000);
});
