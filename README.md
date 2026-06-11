# telewordle

A Wordle bot for Telegram groups. Random 5-letter word, 6 tries, the whole chat plays together — with image/sticker/text boards, a daily puzzle, tournaments with turn timers, duels, leaderboards, multiple languages (English & Russian), hard/super-hard difficulty, and a "creativity mode" that bans recently used words.

## Quick start

1. Create a bot with [@BotFather](https://t.me/BotFather) (`/newbot`) and copy the token.
2. ```sh
   cp .env.example .env   # paste your BOT_TOKEN
   npm install
   npm start
   ```
3. Add the bot to a group and send `/play`.

> **Bare-word guessing in groups** (typing `crane` instead of `/guess crane`) requires the bot to see normal messages: either disable privacy mode in @BotFather (`/setprivacy` → Disable) **before** adding the bot to the group, or make the bot a group admin.

## Commands

| Command | What it does |
|---|---|
| `/play` | Start a new game (random word, 6 tries, shared board) |
| `/daily` | Today's daily puzzle — same word everywhere, daily streaks; `/daily 09:00` auto-posts it, `/daily off` stops |
| `/top` | Chat leaderboard |
| `/guess WORD` | Submit a guess (`/w WORD` works too) |
| `/hint` | Reveal one letter of the word — costs one of the six tries |
| `/history` | Recent games: word, result, who solved it |
| `/vs` | Head-to-head rivalry card (reply to someone or `/vs NAME`) |
| `/define` | Dictionary definition of the last answer (English) |
| `/board` | Show the current board (and tournament standings) |
| `/giveup` | Abandon the game and reveal the word |
| `/stats` | Your stats in this chat |
| `/tournament N` | Start an N-round turn-based tournament |
| `/tournament cancel` | Cancel the open tournament (creator only) |
| `/challenge` | Duel: same word for two players, fewest guesses wins |
| `/usepack NAME` | Render hints with your own custom emoji tile pack (`/usepack off` resets to the bundled default pack) |
| `/settings` | Per-chat settings (see below) |
| `/help` | How to play |

## Settings (`/settings`, per chat)

- **Bare-word guessing** (default **off**) — when on, any message that is a valid 5-letter word counts as a guess. Unknown words get a "not in my dictionary" notice.
- **Board style** (default **image**) — classic Wordle picture (board + letter keyboard), big **sticker** output (512px WebP board + keyboard stickers), or pure text:
  ```
  T R A C E
  🟨🟨🟨⬛🟨

  🟩 GL  🟨 N  ⬛ TESPU  ◻️ QWRYIO…
  ```
- **Difficulty** (default **normal**)
  - **hard** — every revealed green/yellow hint must be used in all later guesses.
  - **super hard** — hard, plus gray letters can't be played again and known letter counts are enforced. You must use *all* information you have.
- **Max failed attempts** (default **5**) — rejected guesses (unknown word, hard-mode or creativity violation) count as fails. In normal games, a player who hits the limit is locked out for the rest of that game; in tournaments, the turn is forfeited. `/settings fails 3`, or `/settings fails off` for unlimited.
- **Turn timer** (default **2m**, tournaments) — the player at turn gets a halftime warning, then their turn is forfeited. `/settings turntime 90s`, or `off`.
- **Board cleanup** (default **on**) — the bot deletes its previous board when posting a fresh one, so the chat stays tidy; the final board of each game is kept. `/settings cleanup off`.
- **Hints** (default **on**) — `/hint` reveals a letter nobody has played yet, at the cost of one try. Disabled in tournaments and duels. `/settings hints off`.
- **Turn pings** (default **on**) — tournament turn announcements @mention the player. `/settings pings off`.
- **Post-game breakdown** (default **on**) — after each normal/daily game, a WordleBot-style analysis shows how much each guess narrowed the possible answers and who got lucky, plus a dictionary definition of the answer. `/settings breakdown off`.
- **Names on the board** — when several people play one board, each row shows who guessed it (all render modes).
- **Reactions** — the bot reacts 🎉 to the winning guess and 😱 to a failed sixth attempt.
- **Language** (default **English**) — `/settings lang ru` switches new games to the Russian word list (ЙЦУКЕН keyboard included; ё plays as е). Adding a language is one entry in `src/engine/languages.ts` plus two word-list files under `data/words/<code>/`.
- **Creativity mode** (default **on, 1-hour window**) — words used recently in this chat (guesses *and* answers) are banned from being guessed and from being picked as the answer. Configure as a time window or a word count:
  ```
  /settings creativity 30m        # s / m / h / d
  /settings creativity 15 words
  ```

## Never locked

If a game or tournament is blocking the chat, `/play`, `/daily`, and `/tournament` show what's running and how long it's been idle, with a **🗑 Disband & start new** button anyone can press — no waiting for whoever started it. As a backstop, abandoned lobbies/tournaments are swept automatically after 3 hours of inactivity (games after 24h), and an active tournament cancels itself if every player lets the turn timer expire twice in a row.

## Tournaments

`/tournament 3` opens a lobby (join or quit via buttons, creator presses Start). Players guess strictly in turn order, and the order rotates every round so nobody is always first. Solving the word scores points by how early it fell: guess #1 = 6 pts … guess #6 = 1 pt. After the last round the bot posts the scoreboard and the winner.

## Duels

`/challenge` in a group posts a button with a deep link. The challenger and the first taker each play the **same secret word** privately with the bot; fewest guesses wins, speed breaks ties. The result (and the word) is announced back in the group.

## Stats

Per user, per chat: games played/won, win rate, winning guesses, current/best streak, fastest solve, total guesses, green/yellow letter accuracy, winning-guess distribution, tournament games/wins/points, duel record.

## Word lists

`data/answers.txt` (2,314 curated answers) and `data/allowed.txt` (10,656 additional accepted guesses) — the classic Wordle lists.

## Development

```sh
npm test                 # engine + game-logic test suite (vitest)
npm run dev              # run with auto-reload
npm run build            # type-check and compile to dist/
npm run render:sample    # render a sample board to /tmp/telewordle-sample.png
```

Stack: TypeScript, [grammY](https://grammy.dev) (long polling — no public URL needed), better-sqlite3, @napi-rs/canvas.

## Docker

```sh
docker build -t telewordle .
docker run -d --name telewordle -e BOT_TOKEN=123:abc -v telewordle-data:/data telewordle
```
