# Discord Activity — End-to-End Plan

Status: **approved, not started**. This document is the single source of truth for the
project. Read it fully before doing any Activity work. Update the milestone checkboxes
as work lands; never delete sections — strike through and annotate instead.

## What we're building

The telewordle game as a **Discord Activity**: a web app embedded in Discord (voice
channels / chat launches) where Daniel's group plays Wordle together with a real UI —
animated boards, private typing, live multiplayer — sharing the exact same game engine
as the Telegram bot. It must be impressive **technically and visually**; the quality
bar is "feels like a polished commercial game", not "works".

## Hard constraints (set by Daniel — do not relitigate)

1. **Daniel will NOT create the Discord application** and **cannot test during
   development**. Everything must be buildable and testable by Claude alone — logic
   AND UI — without a Discord account, app ID, or human eyes.
2. No shortcuts, no half-assing. Strict quality control from the *user's* perspective.
   Every milestone ends with a visual review (see Testing Doctrine).
3. Same repo (monorepo via npm workspaces), AGPL-3.0.
4. The Telegram bot must keep working unchanged throughout.

## Architecture

```
telewordle/
  packages/engine/          ← shared brain (exists today as src/engine + data/words)
      scoring, hard/super-hard, word buckets (3-10 letters, en/ru), creativity-agnostic
      pure logic, analysis (skill/luck/quality), daily + official NYT, languages
  apps/bot/                 ← current Telegram bot, unchanged behavior
  apps/activity/
      client/               ← Vite + React 18 + TypeScript + Tailwind v4 + framer-motion
      server/               ← Fastify + @fastify/websocket + better-sqlite3 (activity.db)
      e2e/                  ← Playwright tests + screenshot review artifacts
```

**The Platform Adapter — the keystone decision.** All Discord-specific code lives
behind one tiny interface in `client/src/platform/`:

```ts
interface PlatformAdapter {
  ready(): Promise<{ user: PlayerIdentity; instanceId: string }>;
  onParticipantsChange(cb: (players: PlayerIdentity[]) => void): void;
}
```

- `DiscordAdapter` — wraps `@discord/embedded-app-sdk` (authorize → backend token
  exchange → authenticate). Written strictly from official docs, kept under ~150
  lines, zero game logic. This is the ONLY code we cannot live-test (see Risks).
- `MockAdapter` — activated by `?mock=<name>` URL param when the server runs with
  `MOCK_AUTH=1` (hard-disabled in production builds). Provides fake identities and
  lets any browser tab join any room. This is how the entire game is developed,
  played, and Playwright-tested without Discord existing at all.

Standalone browser play is therefore a **first-class mode**, not a test hack — the
game must be fully playable at a plain URL. Discord becomes a thin wrapper to flip on
later.

**Server model.** One room per Activity instance (or per mock room ID). Server is
authoritative: clients send intents (`guess`, `hint`, `setSettings`, `start`,
`rematch`), server validates via the engine and broadcasts state. JSON over WS,
versioned protocol, full-state snapshot on join/reconnect + incremental events after.
Room logic is a pure state machine in `server/src/game/` — unit-testable with zero
network. All third-party calls (NYT daily, definitions via OpenRouter/DeepSeek) happen
**server-side only** (Discord's iframe proxy whitelist makes client-side third-party
fetches a trap — never add one).

**Game modes** (in build order):
1. **Co-op** — one shared board, everyone guesses, attribution chips per row (the
   Telegram experience, but live).
2. **Race** — same secret word, each player a private board, opponents visible as
   color-only minimaps (no letters!), first solve / fewest guesses wins, podium at
   the end. The flagship Activity mode.
3. **Daily** — classic 5×6, official NYT word via the engine, one attempt per player
   per day, group results screen.
4. Later (post-v1): turn-based tournament port, cross-platform stats bridge with the
   Telegram bot.

Settings per room (host-controlled, engine-backed): language (en/ru), word length
3-10, tries (default length+1), hard/super-hard. Lifetime quality score and stats
recorded per Discord user ID in activity.db, same metrics as the bot.

## Design direction (commit at M2, then stay consistent)

- Dark, Discord-ambient base (near `#1a1b1e`), the classic tile palette
  (green `#538d4e` / yellow `#b59f3b` / dark `#3a3a3c`) as the only saturated colors,
  one accent for interactive elements. NO generic AI-slop look: no Inter, no purple
  gradients. Distinctive display font for headings (pick during M2 from bundled-able
  options, e.g. Space Grotesk / Clash Display), system stack for body.
- Motion is mandatory: 3D tile flips (staggered, transform-only for 60fps), keyboard
  press feedback, invalid-guess row shake, win confetti, smooth layout transitions
  (framer-motion). Sound effects behind a toggle, off by default.
- Every state designed, not defaulted: loading, empty lobby, waiting-for-host,
  disconnected/reconnecting, error, win, lose, podium. Placeholder UI is a build
  failure, not a TODO.
- Layouts verified at three viewports (see Testing Doctrine): Discord desktop panel
  (~840×620), narrow side-panel (~425×620), mobile portrait (390×844).

## Testing Doctrine (how Claude tests "for real" with no human)

This section is the answer to "you have to figure out a way to test it yourself".

1. **Engine**: existing vitest suite (93 tests) runs from `packages/engine` unchanged.
2. **Room state machine**: vitest unit tests, no network — joins/leaves, mode flows,
   guess validation, race outcomes, hint budget, settings, rematch, edge cases
   (host leaves mid-game, last player leaves, double-join, reconnect mid-flip).
3. **Protocol integration**: vitest boots the real Fastify+WS server on an ephemeral
   port, connects 2-4 raw `ws` clients, plays complete games, asserts every broadcast
   ordering and reconnect resync.
4. **UI end-to-end: Playwright (chromium)** — installed as a dev dependency. Tests
   drive the real client against the real server using MockAdapter: create room, join
   from a second browser context, type on the real on-screen AND physical keyboard,
   watch tiles flip, finish games in every mode, exercise every error state. DOM
   assertions for logic; **screenshots for design**.
5. **The screenshot review ritual (the design-bar gate)**: every milestone produces a
   fixed screenshot set (each key state × three viewports) into `apps/activity/e2e/shots/`.
   Claude MUST open every screenshot with the Read tool and judge it against the
   design bar in CLAUDE.md — alignment, spacing, contrast, truncation, awkward
   wrapping, dead space, theme safety. Anything that would make a designer wince gets
   fixed and re-shot before the milestone closes. No milestone is "done" with an
   unreviewed screenshot.
6. **Multiplayer realism**: one Playwright test runs two contexts side by side and
   asserts state convergence after each action (guess appears on both screens, podium
   identical). Artificial latency (100-300ms) injected in one test to catch races.
7. **Performance budget**: client JS bundle < 350KB gzipped (CI check via build
   output); animations transform/opacity-only; server handles a full 4-player race
   without a single >50ms event-loop stall (measured in the protocol test).
8. **What CANNOT be tested without a Discord app** — the real OAuth handshake and the
   iframe/proxy environment. Mitigations: adapter kept minimal and written verbatim
   from official SDK docs + examples; all external fetches server-side (proxy-safe by
   construction); a written 15-minute **Live Activation Checklist** (below) for the
   day credentials exist. This residual risk is accepted and disclosed — everything
   else IS tested for real.

## Milestones (each ends: all suites green → screenshot ritual → commit+push)

- [ ] **M0 — Workspace migration.** npm workspaces; move `src/engine` + `data/words`
      → `packages/engine` (data path resolved relative to the package via
      import.meta.url, NOT process.cwd); bot imports `@telewordle/engine`; split test
      suites; bot behavior byte-identical; all 93 tests green. Bot deploy story
      unchanged (root `.env`, `npm start -w apps/bot` + root alias).
- [ ] **M1 — Skeleton + rooms.** Fastify server (static client in prod, Vite dev
      proxy in dev), WS room manager, MockAdapter, lobby screen with live participant
      avatars/names, host concept, Playwright smoke (two contexts see each other).
      First screenshot ritual (lobby only).
- [ ] **M2 — Design system + co-op single-board game.** Design tokens, typography,
      board component with flip/shake/pop animations, on-screen + physical keyboard,
      full co-op flow vs engine (validation, hard mode errors as elegant toasts,
      hints, win/lose screens). Heaviest visual iteration loop of the project —
      budget multiple screenshot cycles. Solo play must already feel *good*.
- [ ] **M3 — Real multiplayer.** N players on the co-op board live: attribution,
      presence (typing indicator), join-mid-game, reconnect resync, host migration,
      latency test. Multi-context Playwright suite.
- [ ] **M4 — Race mode + settings.** Private boards, opponent minimaps (colors only),
      countdown start, live progress, podium with stagger animation; room settings
      sheet (language/length/tries/difficulty) host-gated; rematch button.
- [ ] **M5 — Daily + stats + polish.** Daily mode (NYT word, per-player once/day,
      group results + share grid), persistent stats + quality score per player,
      profile/leaderboard screen, sounds, confetti, micro-interactions, every
      empty/error/loading state styled. Full-app screenshot ritual at all viewports.
- [ ] **M6 — Discord integration layer.** DiscordAdapter + `/api/token` exchange
      written and unit-tested against mocked SDK responses; production build hardening
      (MOCK_AUTH stripped); `activity` URL-mapping documentation; CSP audit; the Live
      Activation Checklist finalized.
- [ ] **M7 — Ops.** Multi-stage Dockerfile + compose (bot + activity + volumes),
      `cloudflared` dev-tunnel script, deployment runbook (fly.io and generic-VPS
      variants), README for the whole monorepo.

## Live Activation Checklist (for the future day a Discord app exists)

Whoever has the Discord account: dev portal → New Application → Activities → enable;
copy APP_ID + CLIENT_SECRET into `.env`; add URL mapping `/` → deployed origin; add
redirect URI; launch in a voice channel via Developer Mode. Then Claude verifies:
OAuth completes, identity matches, participants sync, all three modes playable, mobile
client OK. Expected effort: 15 minutes + one fix cycle for surprises in the proxy
environment (most likely candidates: asset paths and websocket URL scheme through the
Discord proxy — both have documented patterns; check SDK docs `patchUrlMappings`).

## Risks & answers

| Risk | Answer |
|---|---|
| OAuth/iframe layer untestable until a Discord app exists | Adapter ≤150 lines, docs-verbatim, mocked-SDK unit tests, activation checklist; game itself 100% testable standalone |
| Discord proxy blocks third-party fetches | All external calls server-side from day one (architecture rule, enforced in review) |
| Visual quality without a human eye | Screenshot ritual is mandatory per milestone; the standalone web mode also means Daniel can open a plain URL from his phone the moment hosting exists — earliest possible human feedback without Discord |
| Scope creep killing polish | Tournament port and Telegram-stats bridge explicitly post-v1 |
| Monorepo breaks the running bot | M0 gate: byte-identical bot behavior, full suite green, restart instructions to Daniel |

## Conventions

- Commits prefixed `engine:` / `bot:` / `activity:`. Push after every milestone.
- The CLAUDE.md design bar applies to every Activity screen; this plan's Testing
  Doctrine is the enforcement mechanism.
- New deps require justification in the commit message (bundle budget!).
- Activity DB is separate (`activity.db`); never touch the bot's `telewordle.db`.
