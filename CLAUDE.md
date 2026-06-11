# telewordle — project notes

> **Discord Activity project:** the approved end-to-end plan lives in
> `docs/discord-activity-plan.md`. Read it before any Activity work — it defines the
> architecture, milestones, and the mandatory Testing Doctrine (Playwright + the
> screenshot review ritual). Daniel cannot create the Discord app or test during
> development; everything must be self-verified per that doctrine.

Telegram Wordle bot for a 4-person friend group chat. Owner: Daniel (@Argotoss).
There is a fork by his friend Artem (https://github.com/ExposedCat/telewordle) that
repeatedly out-polished us on UI/UX. Treat it as a design rival: before building any
user-facing feature, check how the fork does it (`git fetch <fork-url> main:friend-fork`),
adopt what's better, and then improve on it. Never copy verbatim — copy and surpass.

## Design bar — every user-visible change must clear ALL of these before shipping

1. **Render it and look at it.** Any image/sticker output: render a realistic sample
   (multiple players, long names, Cyrillic, edge cases) and inspect it visually with
   the Read tool before committing. Any text output: print the exact message and read
   it as if you were in the chat.
2. **Telegram-native beats informative.** Prefer stickers (512px transparent WebP) over
   photos, colored/styled inline buttons over plain ones, custom emoji tiles over text,
   reactions over confirmation messages, clickable `tg://user?id=` mentions over plain
   names. Plain multi-paragraph text is the output of last resort.
3. **Message economy.** Every message must earn its place in a 4-person chat. Silence is
   a valid response (spectator noise, redundant confirmations). Old boards get cleaned
   up. One compact message beats three informative ones.
4. **Theme-safe.** Stickers float on the user's chat background, which can be light or
   dark. Never bare light text on transparency — put text on dark badge pills.
5. **Escape user input in HTML.** Any `parse_mode: 'HTML'` message interpolating user
   names or words must go through `escapeHtml`.
6. **Graceful degradation.** Every fancy surface (custom emoji, styled buttons, LLM
   calls, external APIs) needs a working plain fallback wrapped in try/catch. Fancy may
   fail; the game flow may not.
7. **Never lock the chat.** Any new blocking state needs a way for ANYONE (not just the
   creator) to clear it, plus a long backstop auto-expiry.

## Engineering conventions

- Run `npx vitest run` and `npx tsc --noEmit` before every commit; keep both green.
- DB schema changes need a PRAGMA-guarded migration in `openDb` (users have live DBs).
- The bot runs via `npm start` (tsx, no hot reload) — remind Daniel to restart after
  pulling changes.
- Word lists live in `data/words/<lang>/`; adding a language = one entry in
  `src/engine/languages.ts` + two list files.
- Commit and push to `main` after each completed feature; Daniel's commits carry his
  name, no co-author trailer.
