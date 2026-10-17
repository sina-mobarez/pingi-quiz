// Player accounts, login sessions and lifetime stats, kept in one JSON file.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { GameError } = require('./game');

const USERNAME = /^[\p{L}\p{N}_]{3,20}$/u;
const MIN_PASSWORD = 6;
const MAX_PASSWORD = 100;
const SCRYPT_KEYLEN = 64;
const START_RATING = 1000;
const RATING_K = 32;

const hashToken = token => crypto.createHash('sha256').update(String(token)).digest('hex');
const keyOf = username => String(username).normalize('NFC').toLowerCase();

function emptyStats() {
  return { games: 0, wins: 0, score: 0, correct: 0, questions: 0, best: 0, rating: START_RATING, bestStreak: 0 };
}

class Accounts {
  // file: where users and sessions persist; null keeps everything in memory (tests).
  constructor(file = null) {
    this.file = file;
    this.data = { users: {}, sessions: {} };
    if (file && fs.existsSync(file)) this.data = JSON.parse(fs.readFileSync(file, 'utf8'));
    // Accounts saved before a stat existed get its starting value.
    for (const u of Object.values(this.data.users)) u.stats = { ...emptyStats(), ...u.stats };
  }

  register(username, password) {
    const name = String(username || '').trim().normalize('NFC');
    if (!USERNAME.test(name)) throw new GameError('نام کاربری باید ۳ تا ۲۰ حرف، عدد یا _ باشد');
    checkPassword(password);
    const key = keyOf(name);
    if (this.data.users[key]) throw new GameError('این نام کاربری قبلاً ثبت شده است', 409);
    const salt = crypto.randomBytes(16).toString('hex');
    this.data.users[key] = {
      username: name, salt, hash: scrypt(password, salt), createdAt: Date.now(), stats: emptyStats(),
    };
    return this._newSession(key);
  }

  login(username, password) {
    const user = this.data.users[keyOf(String(username || '').trim())];
    // Hash even for unknown users so response time doesn't reveal which names exist.
    const actual = Buffer.from(scrypt(String(password || ''), user ? user.salt : 'no-such-user'), 'hex');
    if (!user || !crypto.timingSafeEqual(actual, Buffer.from(user.hash, 'hex'))) {
      throw new GameError('نام کاربری یا رمز عبور اشتباه است', 401);
    }
    return this._newSession(keyOf(user.username));
  }

  logout(token) {
    delete this.data.sessions[hashToken(token)];
    this._save();
  }

  // The user a session token belongs to, or null.
  userFor(token) {
    if (!token) return null;
    const key = this.data.sessions[hashToken(token)];
    return (key && this.data.users[key]) || null;
  }

  requireUser(token) {
    const user = this.userFor(token);
    if (!user) throw new GameError('لطفاً ابتدا وارد حساب کاربری خود شوید', 401);
    return user;
  }

  profile(user) {
    return { username: user.username, ...publicStats(user.stats) };
  }

  // results: [{ name, score, correctCount, total, rank, bestStreak }] for one finished game.
  // Returns the rating change of each account in a multiplayer game: { name: { rating, delta } }.
  recordGame(results) {
    const multiplayer = results.length > 1;
    const deltas = multiplayer ? this._ratingDeltas(results) : new Map();
    const ratings = {};
    for (const r of results) {
      const user = this.data.users[keyOf(r.name)];
      if (!user) continue;
      const s = user.stats;
      if (deltas.has(r)) {
        s.rating += deltas.get(r);
        ratings[r.name] = { rating: s.rating, delta: deltas.get(r) };
      }
      s.bestStreak = Math.max(s.bestStreak, r.bestStreak || 0);
      s.games++;
      if (multiplayer && r.rank === 1 && r.score > 0) s.wins++;
      s.score += r.score;
      s.correct += r.correctCount;
      s.questions += r.total;
      s.best = Math.max(s.best, r.score);
    }
    this._save();
    return ratings;
  }

  // Elo, with every pair of players counted as one match (higher score wins, equal scores draw)
  // and K split across opponents, so a race moves a rating about as much as one duel.
  _ratingDeltas(results) {
    const ratingOf = r => (this.data.users[keyOf(r.name)] || { stats: emptyStats() }).stats.rating;
    const k = RATING_K / (results.length - 1);
    const deltas = new Map();
    for (const a of results) {
      let sum = 0;
      for (const b of results) {
        if (a === b) continue;
        const expected = 1 / (1 + 10 ** ((ratingOf(b) - ratingOf(a)) / 400));
        const actual = a.score > b.score ? 1 : a.score === b.score ? 0.5 : 0;
        sum += actual - expected;
      }
      deltas.set(a, Math.round(k * sum));
    }
    return deltas;
  }

  // Best and worst players by rating; only players who finished a game are ranked.
  leaderboard(limit = 10) {
    const players = Object.values(this.data.users)
      .filter(u => u.stats.games > 0)
      .map(u => ({ username: u.username, ...publicStats(u.stats) }))
      .sort((a, b) => b.rating - a.rating || b.score - a.score || b.accuracy - a.accuracy || a.games - b.games
        || a.username.localeCompare(b.username));
    players.forEach((p, i) => { p.rank = i + 1; });
    return { total: players.length, best: players.slice(0, limit), worst: players.slice(-limit).reverse() };
  }

  _newSession(key) {
    const token = crypto.randomBytes(32).toString('hex');
    this.data.sessions[hashToken(token)] = key;
    this._save();
    return { token, user: this.profile(this.data.users[key]) };
  }

  // Write to a temp file then rename, so a crash mid-write never leaves a half-written file.
  _save() {
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data));
    fs.renameSync(tmp, this.file);
  }
}

function checkPassword(password) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD || password.length > MAX_PASSWORD) {
    throw new GameError(`رمز عبور باید دست‌کم ${MIN_PASSWORD.toLocaleString('fa-IR')} نویسه باشد`);
  }
}

function scrypt(password, salt) {
  return crypto.scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex');
}

function publicStats(s) {
  return {
    games: s.games, wins: s.wins, score: s.score, best: s.best, rating: s.rating, bestStreak: s.bestStreak,
    accuracy: s.questions ? Math.round((100 * s.correct) / s.questions) : 0,
  };
}

module.exports = { Accounts };
