# telewordle

A Wordle bot for Telegram groups. Random 5-letter word, 6 tries, the whole chat plays together — with image or text boards, tournaments, duels, hard/super-hard difficulty, and a "creativity mode" that bans recently used words.

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
| `/guess WORD` | Submit a guess (`/w WORD` works too) |
| `/board` | Show the current board (and tournament standings) |
| `/giveup` | Abandon the game and reveal the word |
| `/stats` | Your stats in this chat |
| `/tournament N` | Start an N-round turn-based tournament |
| `/tournament cancel` | Cancel the open tournament (creator only) |
| `/challenge` | Duel: same word for two players, fewest guesses wins |
| `/usepack NAME` | Render hints with a custom emoji tile pack (`/usepack off` to remove) |
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
- **Max failed attempts** (default **5**, tournaments only) — rejected guesses by the player at turn (unknown word, hard-mode or creativity violation) count as fails; hitting the limit forfeits the turn, so nobody can stall by spamming nonsense. `/settings fails 3`, or `/settings fails off` for unlimited.
- **Creativity mode** (default **on, 1-hour window**) — words used recently in this chat (guesses *and* answers) are banned from being guessed and from being picked as the answer. Configure as a time window or a word count:
  ```
  /settings creativity 30m        # s / m / h / d
  /settings creativity 15 words
  ```

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
