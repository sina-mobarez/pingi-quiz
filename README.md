# Quiz Race

A multiplayer quiz race for your local network, with timed questions, player accounts and a leaderboard. It needs no npm packages and no database.

```bash
node server.js        # or: npm start   (PORT=4000 node server.js to change port)
npm test              # game-logic tests
```

1. Open http://localhost:3000 and register (username and password) or log in. Then choose a category, difficulty, number of questions and seconds per question.
2. Share the 4-letter room code or the LAN link shown in the lobby. Players on the same Wi-Fi join from their own browsers.
3. The host presses **Start**. Every player gets the same questions. A correct answer scores 500–1000 points, more the faster it comes. Keys 1–4 also answer.
   - **Streaks 🔥**: each correct answer in a row after the first adds a bonus of +50, up to +250. A wrong answer or a timeout resets it.
   - After each question the scoreboard marks the fastest correct answer with ⚡ and shows who moved up ▲ or down ▼.
4. **🏆 جدول برترین‌ها** shows the 10 best and the 10 worst players by rating, with total points, games, wins and accuracy, plus your own stats and best streak. Every finished race counts; a win needs at least two players.
5. **Rating**: every account starts at 1000. After a race with two or more players, ratings change Elo-style: each pair of players counts as one match (the higher score wins). Beating stronger players gains more. The final screen shows each player's change.

## Accounts
Accounts and lifetime stats are kept in `data/users.json` (set `USERS_FILE` to move it; it is git-ignored). Passwords are stored as salted scrypt hashes and login tokens only as SHA-256 hashes, so the file holds no secrets in plain text. A username is 3–20 letters, digits or `_` (Persian letters work); the password needs at least 6 characters. Your username is your name in every room; opening a room again with the same account gets your seat back.

## Questions
18 categories, including «هوش و استعداد (IQ)» with number and letter sequences, analogies, logic puzzles and symbol-grid pattern puzzles, and «حیوانات و طبیعت», «نجوم و فضا» and «بدن انسان و سلامت». Difficulties are easy, medium, hard and expert («خیلی سخت»); every category has at least 20 questions at each difficulty. All questions are Persian; a room shows 4, 6 or 8 options per question.
Choose «همه دسته‌ها (mixed)» to race across every category; questions are taken from each category in turn.

To add questions, edit a file in `questions/` or add a new `questions/<n>-<name>.json` (files load in name order, which sets the category order):
```json
{ "id": "unique-id", "category": "شبکه", "difficulty": "easy|medium|hard|expert",
  "question": "…", "code": "optional snippet or symbol grid", "answer": "correct option",
  "distractors": ["7 or more wrong options, most plausible first"], "explanation": "optional" }
```
See `docs/question-guide.md`. The server checks every question when it starts and refuses to start if a question is invalid, naming the file and question id. Restart the server after editing.
`questions.en.json` holds the old English bank. The server doesn't load it.

## Files
- `server.js`: HTTP server, JSON API, live updates (Server-Sent Events), question loading and checks
- `game.js`: room and scoring logic, kept in memory
- `accounts.js`: registration, login sessions, lifetime stats and the leaderboard
- `public/index.html`: the whole web page (Persian text shown right-to-left)
- `questions/`: question bank, one file per category
