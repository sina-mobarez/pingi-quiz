// Pure in-memory game logic. No I/O: every time-dependent call takes `now` (ms).
const crypto = require('node:crypto');
const { DIFFICULTIES, OPTION_COUNTS, buildOptions } = require('./questions');

const COUNTDOWN_MS = 3000;
const REVEAL_MS = 4000;
const HOST_GRACE_MS = 5000;
const IDLE_ROOM_MS = 30 * 60_000;
const STREAK_STEP = 50;  // bonus per correct answer in a row after the first
const STREAK_MAX_BONUS = 250;
const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I/O to avoid confusion with 1/0

class GameError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

class RoomManager {
  constructor(questions, { rng = Math.random } = {}) {
    this.bank = questions;
    this.rng = rng;
    this.rooms = new Map();
  }

  categories() {
    const map = new Map();
    for (const q of this.bank) {
      if (!map.has(q.category)) map.set(q.category, Object.fromEntries(DIFFICULTIES.map(d => [d, 0])));
      map.get(q.category)[q.difficulty]++;
    }
    return [...map].map(([name, counts]) => ({ name, counts }));
  }

  createRoom({ nickname, category, difficulty, count, seconds, optionCount = 4 }, now) {
    const name = cleanName(nickname);
    if (category !== 'mixed' && !this.bank.some(q => q.category === category)) throw new GameError('این دسته وجود ندارد');
    if (difficulty !== 'mixed' && !DIFFICULTIES.includes(difficulty)) throw new GameError('سطح سختی نامعتبر است');
    count = clampInt(count, 1, 50, 10);
    seconds = clampInt(seconds, 5, 120, 20);
    optionCount = Number(optionCount);
    if (!OPTION_COUNTS.includes(optionCount)) throw new GameError('تعداد گزینه‌ها باید ۴، ۶ یا ۸ باشد');
    const settings = { category, difficulty, count, seconds, optionCount };
    const seen = new Set();
    const room = {
      code: this._newCode(),
      settings,
      hostId: null,
      players: new Map(),
      seen,
      questions: this._pickQuestions(settings, seen),
      index: -1,
      phase: 'lobby',
      phaseEndsAt: null,
      questionStartedAt: null,
      answers: new Map(),
      ratings: null,
      lastActivity: now,
    };
    const player = this._addPlayer(room, name, now);
    room.hostId = player.id;
    this.rooms.set(room.code, room);
    return { code: room.code, playerId: player.id };
  }

  // Names are account usernames checked by the server, so the same name joining again
  // is the same person coming back (new tab, lost session): they get their seat back.
  joinRoom(code, nickname, now) {
    const room = this._getRoom(code);
    const name = cleanName(nickname);
    for (const p of room.players.values()) {
      if (p.name.toLowerCase() === name.toLowerCase()) return { playerId: p.id };
    }
    if (room.phase !== 'lobby') throw new GameError('این مسابقه شروع شده است', 409);
    return { playerId: this._addPlayer(room, name, now).id };
  }

  start(code, playerId, now) {
    const room = this._getRoom(code);
    this._requireHost(room, playerId);
    if (room.phase !== 'lobby') throw new GameError('مسابقه از قبل شروع شده است', 409);
    this._beginCountdown(room, now);
  }

  restart(code, playerId, now) {
    const room = this._getRoom(code);
    this._requireHost(room, playerId);
    if (room.phase !== 'final') throw new GameError('مسابقه هنوز تمام نشده است', 409);
    room.questions = this._pickQuestions(room.settings, room.seen);
    for (const p of room.players.values()) {
      Object.assign(p, { score: 0, correctMs: 0, correctCount: 0, streak: 0, bestStreak: 0, rankBefore: null, last: null });
    }
    room.ratings = null;
    this._beginCountdown(room, now);
  }

  answer(code, playerId, option, now) {
    const room = this._getRoom(code);
    const player = this._requirePlayer(room, playerId);
    if (room.phase !== 'question') throw new GameError('الان زمان پاسخ دادن نیست', 409);
    if (now > room.phaseEndsAt) throw new GameError('وقت تمام شد', 409);
    if (room.answers.has(playerId)) throw new GameError('شما قبلاً پاسخ داده‌اید', 409);
    const q = room.questions[room.index];
    if (!Number.isInteger(option) || option < 0 || option >= q.options.length) throw new GameError('گزینه‌ی نامعتبر');

    const correct = option === q.answer;
    const limit = room.settings.seconds * 1000;
    const remaining = Math.max(0, room.phaseEndsAt - now);
    const prevStreak = player.streak;
    player.streak = correct ? player.streak + 1 : 0;
    player.bestStreak = Math.max(player.bestStreak, player.streak);
    const bonus = correct ? Math.min(STREAK_MAX_BONUS, (player.streak - 1) * STREAK_STEP) : 0;
    const points = correct ? 500 + Math.round((500 * remaining) / limit) + bonus : 0;
    room.answers.set(playerId, { option, at: now });
    const ms = correct ? now - room.questionStartedAt : 0;
    player.last = { correct, points, bonus, ms, prevStreak };
    player.score += points;
    player.correctMs += ms;
    if (correct) player.correctCount++;
    room.lastActivity = now;

    const waiting = [...room.players.values()].some(p => p.connected && !room.answers.has(p.id));
    if (!waiting) this._reveal(room, now);
  }

  // Rating changes from the server once a finished race is recorded: { name: { rating, delta } }.
  setRatings(code, ratings) {
    const room = this.rooms.get(code);
    if (room && room.phase === 'final') room.ratings = ratings;
  }

  setConnected(code, playerId, connected, now) {
    const room = this.rooms.get(code);
    const player = room && room.players.get(playerId);
    if (!player) return;
    player.connected = connected;
    player.disconnectedAt = connected ? null : now;
    room.lastActivity = now;
  }

  // Advances phases whose deadlines passed, hands over host, deletes idle rooms.
  // `finished` lists the final standings of every race that ended on this tick.
  tick(now) {
    const changed = [];
    const removed = [];
    const finished = [];
    for (const room of this.rooms.values()) {
      const anyConnected = [...room.players.values()].some(p => p.connected);
      if (!anyConnected && now - room.lastActivity > IDLE_ROOM_MS) {
        this.rooms.delete(room.code);
        removed.push(room.code);
        continue;
      }
      let dirty = false;
      if (room.phaseEndsAt !== null && now >= room.phaseEndsAt) {
        if (room.phase === 'countdown') this._nextQuestion(room, now);
        else if (room.phase === 'question') this._reveal(room, now);
        else if (room.phase === 'reveal') {
          if (room.index + 1 < room.questions.length) this._nextQuestion(room, now);
          else {
            this._setPhase(room, 'final', null);
            finished.push({ code: room.code, results: this._results(room) });
          }
        }
        dirty = true;
      }
      const host = room.players.get(room.hostId);
      if (host && !host.connected && now - host.disconnectedAt >= HOST_GRACE_MS) {
        const next = [...room.players.values()].find(p => p.connected);
        if (next) {
          room.hostId = next.id;
          dirty = true;
        }
      }
      if (dirty) changed.push(room.code);
    }
    return { changed, removed, finished };
  }

  hasPlayer(code, playerId) {
    const room = this.rooms.get(code);
    return Boolean(room && room.players.has(playerId));
  }

  publicState(code, playerId, now) {
    const room = this._getRoom(code);
    const { phase } = room;
    const showQuestion = phase === 'question' || phase === 'reveal';
    const q = showQuestion ? room.questions[room.index] : null;
    const mine = room.answers.get(playerId);
    const ranks = ranked(room);
    return {
      code: room.code,
      phase,
      phaseEndsAt: room.phaseEndsAt,
      serverNow: now,
      settings: room.settings,
      total: room.questions.length,
      you: playerId,
      hostId: room.hostId,
      players: ranks.map((p, i) => ({
        id: p.id,
        name: p.name,
        score: p.visible.score,
        correctCount: p.visible.correctCount,
        streak: p.visible.streak,
        bestStreak: p.bestStreak,
        connected: p.connected,
        answered: room.answers.has(p.id),
        lastCorrect: phase === 'reveal' && p.last ? p.last.correct : null,
        lastPoints: phase === 'reveal' && p.last ? p.last.points : null,
        lastBonus: phase === 'reveal' && p.last ? p.last.bonus : null,
        // Places gained (+) or lost (-) on this question.
        move: phase === 'reveal' && p.rankBefore !== null ? p.rankBefore - i : null,
        rating: phase === 'final' && room.ratings ? room.ratings[p.name] || null : null,
      })),
      question: q && {
        index: room.index,
        category: q.category,
        difficulty: q.difficulty,
        question: q.question,
        code: q.code || null,
        options: q.options,
      },
      myAnswer: showQuestion && mine ? mine.option : null,
      reveal: phase === 'reveal' ? { answer: q.answer, explanation: q.explanation || null, fastest: fastest(room) } : null,
    };
  }

  _results(room) {
    return ranked(room).map((p, i) => ({
      name: p.name, score: p.score, correctCount: p.correctCount, total: room.questions.length, rank: i + 1,
      bestStreak: p.bestStreak,
    }));
  }

  // For tests.
  _room(code) {
    return this._getRoom(code);
  }

  _beginCountdown(room, now) {
    room.index = -1;
    room.answers = new Map();
    this._setPhase(room, 'countdown', now + COUNTDOWN_MS);
  }

  _nextQuestion(room, now) {
    // Remember standings before the question so the reveal can show who moved up or down.
    ranked(room).forEach((p, i) => { room.players.get(p.id).rankBefore = room.index < 0 ? null : i; });
    room.index++;
    room.answers = new Map();
    room.questionStartedAt = now;
    for (const p of room.players.values()) p.last = null;
    this._setPhase(room, 'question', now + room.settings.seconds * 1000);
  }

  // Not answering breaks a streak just like a wrong answer.
  _reveal(room, now) {
    for (const p of room.players.values()) if (!room.answers.has(p.id)) p.streak = 0;
    this._setPhase(room, 'reveal', now + REVEAL_MS);
  }

  _setPhase(room, phase, endsAt) {
    room.phase = phase;
    room.phaseEndsAt = endsAt;
  }

  _addPlayer(room, name, now) {
    const player = {
      id: crypto.randomUUID(), name, score: 0, correctMs: 0, correctCount: 0, streak: 0, bestStreak: 0,
      rankBefore: null, connected: false, disconnectedAt: now, last: null,
    };
    room.players.set(player.id, player);
    room.lastActivity = now;
    return player;
  }

  // Questions this room has not played yet come first, so "play again" brings new ones;
  // once the pool runs out the room starts over with everything.
  _pickQuestions({ category, difficulty, count, optionCount }, seen) {
    const pool = this.bank.filter(q =>
      (category === 'mixed' || q.category === category) && (difficulty === 'mixed' || q.difficulty === difficulty));
    if (pool.length === 0) throw new GameError('برای این دسته و سطح سختی سؤالی وجود ندارد');
    let fresh = pool.filter(q => !seen.has(q.id));
    if (fresh.length < Math.min(count, pool.length)) {
      for (const q of pool) seen.delete(q.id);
      fresh = pool;
    }
    // Take from each category in turn so a big category doesn't dominate a mixed race.
    const byCategory = new Map();
    for (const q of this._shuffle(fresh)) {
      if (!byCategory.has(q.category)) byCategory.set(q.category, []);
      byCategory.get(q.category).push(q);
    }
    const queues = this._shuffle([...byCategory.values()]);
    const picked = [];
    while (picked.length < count && queues.some(qs => qs.length)) {
      for (const qs of queues) if (qs.length && picked.length < count) picked.push(qs.shift());
    }
    for (const q of picked) seen.add(q.id);
    return this._shuffle(picked).map(q => ({ ...q, ...buildOptions(q, optionCount, a => this._shuffle(a)) }));
  }

  _shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  _newCode() {
    for (;;) {
      let code = '';
      for (let i = 0; i < 4; i++) code += CODE_LETTERS[crypto.randomInt(CODE_LETTERS.length)];
      if (!this.rooms.has(code)) return code;
    }
  }

  _getRoom(code) {
    const room = this.rooms.get(String(code || '').toUpperCase());
    if (!room) throw new GameError('اتاق پیدا نشد', 404);
    return room;
  }

  _requirePlayer(room, playerId) {
    const p = room.players.get(playerId);
    if (!p) throw new GameError('شما عضو این اتاق نیستید', 403);
    return p;
  }

  _requireHost(room, playerId) {
    this._requirePlayer(room, playerId);
    if (room.hostId !== playerId) throw new GameError('فقط میزبان می‌تواند این کار را انجام دهد', 403);
  }
}

// While a question is open, scores exclude it so nobody can tell who was right.
function ranked(room) {
  const hide = room.phase === 'question';
  return [...room.players.values()]
    .map(p => {
      const l = hide && p.last ? p.last : { points: 0, ms: 0, correct: false, prevStreak: p.streak };
      const visible = {
        score: p.score - l.points, correctMs: p.correctMs - l.ms, correctCount: p.correctCount - (l.correct ? 1 : 0),
        streak: l.prevStreak,
      };
      return { ...p, visible };
    })
    .sort((a, b) =>
      b.visible.score - a.visible.score || a.visible.correctMs - b.visible.correctMs || a.name.localeCompare(b.name));
}

// The player with the quickest correct answer on the current question, or null.
function fastest(room) {
  let best = null;
  for (const [id, a] of room.answers) {
    const p = room.players.get(id);
    if (p.last && p.last.correct && (!best || a.at < best.at)) best = { id, at: a.at };
  }
  return best && best.id;
}

function cleanName(name) {
  const n = String(name || '').trim().slice(0, 20);
  if (!n) throw new GameError('لطفاً یک نام مستعار وارد کنید');
  return n;
}

function clampInt(v, min, max, fallback) {
  const n = Number.parseInt(v, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

module.exports = { RoomManager, GameError, COUNTDOWN_MS, REVEAL_MS, HOST_GRACE_MS, STREAK_STEP, STREAK_MAX_BONUS };
