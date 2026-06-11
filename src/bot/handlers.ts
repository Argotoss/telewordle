import type Database from 'better-sqlite3';
import { Api, Bot, Context, InlineKeyboard, InputFile } from 'grammy';
import {
  GameRow,
  TournamentRow,
  activeTournamentChats,
  allChatIds,
  finishedDuels,
  getChatStats,
  recentFinishedGames,
} from '../db.js';
import { analyzeGame } from '../engine/analysis.js';
import { LANGUAGES, looksLikeGuess } from '../engine/languages.js';
import { GameService, MAX_GUESSES, UserRef, maxGuessesFor, roundOrder } from '../game/service.js';
import { fetchDefinition } from './define.js';
import {
  emojiPackFromStickers,
  escapeHtml,
  packNameCandidates,
  resolveEmojiPack,
  type EmojiPackConfig,
} from '../render/emoji-pack.js';
import { renderBoardImage, renderBoardSticker, renderKeyboardSticker } from '../render/image.js';
import { textBoard } from '../render/text.js';
import {
  DIFFICULTY_LABEL,
  HELP_TEXT,
  RENDER_LABEL,
  alreadyGuessedText,
  breakdownText,
  dailyShareText,
  hardModeViolationText,
  historyText,
  vsText,
  humanDuration,
  humanMs,
  parseCreativityValue,
  parseDuration,
  settingsText,
  standingsText,
  statsText,
  timeAgo,
  topText,
  turnOrderText,
} from './format.js';

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function nowHHMM(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function userRef(ctx: Context): UserRef {
  const u = ctx.from!;
  const name = [u.first_name, u.last_name].filter(Boolean).join(' ') || u.username || 'Player';
  return { id: u.id, name };
}

function settingsKeyboard(svc: GameService, chatId: number): InlineKeyboard {
  const s = svc.settings(chatId);
  return new InlineKeyboard()
    .text(`Bare-word guessing: ${s.bareWord ? 'ON ✅' : 'OFF'}`, 'set:bare')
    .row()
    .text(`Board style: ${RENDER_LABEL[s.render]}`, 'set:render')
    .row()
    .text(`Difficulty: ${DIFFICULTY_LABEL[s.difficulty]}`, 'set:difficulty')
    .row()
    .text(`Creativity mode: ${s.creativity.enabled ? 'ON ✅' : 'OFF'}`, 'set:creativity');
}

// Lobby look adopted from PR #2: custom people emoji, clickable player names,
// and colored buttons with icon emoji (Join green, Start blue, Quit red).
const PEOPLE_EMOJI = '<tg-emoji emoji-id="5942877472163892475">👥</tg-emoji>';
const JOIN_EMOJI_ID = '5920090136627908485';
const QUIT_EMOJI_ID = '5922712343011135025';
const START_EMOJI_ID = '5994378304751145264';

function lobbyTextHtml(t: TournamentRow): string {
  const names = t.players
    .map((p) => `<a href="tg://user?id=${p.userId}">${escapeHtml(p.userName)}</a>`)
    .join(', ');
  return `${PEOPLE_EMOJI} ${names} · ${t.rounds}

Players guess in order, ${MAX_GUESSES} max guesses, faster solution gives more points!`;
}

function lobbyTextPlain(t: TournamentRow): string {
  const names = t.players.map((p) => p.userName).join(', ');
  return `🏆 Tournament — ${t.rounds} round${t.rounds > 1 ? 's' : ''}
Players (${t.players.length}): ${names}

Players guess in order, ${MAX_GUESSES} max guesses, faster solution gives more points!`;
}

/** Colored buttons with custom emoji icons — not in grammY's types yet, so shaped by hand. */
function lobbyKeyboardStyled(t: TournamentRow): InlineKeyboard {
  return {
    inline_keyboard: [
      [
        { text: 'Join', callback_data: `t:join:${t.id}`, style: 'success', icon_custom_emoji_id: JOIN_EMOJI_ID },
        { text: 'Start', callback_data: `t:start:${t.id}`, style: 'primary', icon_custom_emoji_id: START_EMOJI_ID },
      ],
      [{ text: 'Quit', callback_data: `t:quit:${t.id}`, style: 'danger', icon_custom_emoji_id: QUIT_EMOJI_ID }],
    ],
  } as unknown as InlineKeyboard;
}

function lobbyKeyboardPlain(t: TournamentRow): InlineKeyboard {
  return new InlineKeyboard()
    .text('✋ Join', `t:join:${t.id}`)
    .text('▶️ Start', `t:start:${t.id}`)
    .row()
    .text('🚪 Quit', `t:quit:${t.id}`);
}

export function registerHandlers(bot: Bot, db: Database.Database): void {
  const svc = new GameService(db);

  // ---------- tournament turn timers ----------

  const turnTimers = new Map<number, ReturnType<typeof setTimeout>[]>();

  function clearTurnTimers(chatId: number): void {
    for (const h of turnTimers.get(chatId) ?? []) clearTimeout(h);
    turnTimers.delete(chatId);
  }

  function scheduleTurnTimers(chatId: number): void {
    clearTurnTimers(chatId);
    const s = svc.settings(chatId);
    if (s.turnTime <= 0) return;
    const t = svc.openTournament(chatId);
    if (!t || t.status !== 'active') return;
    const current = roundOrder(t.players, t.current_round)[t.turn_idx % t.players.length];
    // only fire if the turn hasn't moved on since this timer was set
    const stamp = `${t.id}:${t.current_round}:${t.turn_idx}`;
    const sameTurn = () => {
      const cur = svc.openTournament(chatId);
      return cur !== null && cur.status === 'active' && `${cur.id}:${cur.current_round}:${cur.turn_idx}` === stamp;
    };
    const timers: ReturnType<typeof setTimeout>[] = [];
    if (s.turnTime >= 40) {
      timers.push(
        setTimeout(() => {
          if (!sameTurn()) return;
          bot.api
            .sendMessage(chatId, `⏰ ${current.userName}, ${humanDuration(Math.ceil(s.turnTime / 2))} left on your turn!`)
            .catch(() => {});
        }, (s.turnTime * 1000) / 2)
      );
    }
    timers.push(
      setTimeout(async () => {
        if (!sameTurn()) return;
        const res = svc.forfeitTurnByTimeout(chatId);
        if (!res) return;
        if (res.abandoned) {
          clearTurnTimers(chatId);
          const reveal = res.answer ? ` The word was ${res.answer.toUpperCase()}.` : '';
          await bot.api
            .sendMessage(chatId, `💤 Nobody is playing — tournament cancelled.${reveal} Start fresh anytime with /tournament.`)
            .catch(() => {});
          return;
        }
        await bot.api
          .sendMessage(chatId, `⏱ Time's up, ${res.skipped.userName}! 🚷 Turn passes to ${res.nextPlayer.userName}.`)
          .catch(() => {});
        scheduleTurnTimers(chatId);
      }, s.turnTime * 1000)
    );
    turnTimers.set(chatId, timers);
  }

  // tournaments that were mid-game when the bot restarted get their clocks back
  for (const chatId of activeTournamentChats(db)) scheduleTurnTimers(chatId);

  // ---------- daily puzzle scheduler ----------

  setInterval(async () => {
    const hhmm = nowHHMM();
    for (const chatId of allChatIds(db)) {
      try {
        // backstop: sweep up long-abandoned tournaments and games
        const staleT = svc.expireStaleTournament(chatId);
        if (staleT) {
          clearTurnTimers(chatId);
          const reveal = staleT.answer ? ` The word was ${staleT.answer.toUpperCase()}.` : '';
          await bot.api
            .sendMessage(chatId, `🧹 Cleaned up an abandoned tournament${staleT.kind === 'lobby' ? ' lobby' : ''}.${reveal}`)
            .catch(() => {});
        }
        const staleG = svc.expireStaleGame(chatId);
        if (staleG) {
          boardMsgs.delete(chatId);
          await bot.api
            .sendMessage(chatId, `🧹 Cleaned up an abandoned game — the word was ${staleG.answer.toUpperCase()}.`)
            .catch(() => {});
        }

        if (svc.settings(chatId).dailyTime !== hhmm) continue;
        const res = svc.startDaily(chatId, todayStr());
        if (res === 'done' || res === 'busy' || !res.created) continue;
        await sendBoard(
          bot.api,
          chatId,
          res.game,
          `☀️ Daily puzzle — ${todayStr()}. Same word for everyone today, 6 tries. Go!`
        );
      } catch {
        // one chat failing must not break the sweep
      }
    }
  }, 60_000);

  // Board cleanup: remember the bot's last board-related messages per chat so
  // they can be deleted when a fresh board is posted. The final board of a
  // finished game is never cleaned up — it stays as the game's record.
  const boardMsgs = new Map<number, number[]>();

  async function cleanupOldBoards(api: Api, chatId: number): Promise<void> {
    if (!svc.settings(chatId).cleanup) return;
    for (const id of boardMsgs.get(chatId) ?? []) {
      await api.deleteMessage(chatId, id).catch(() => {});
    }
    boardMsgs.delete(chatId);
  }

  async function sendBoard(api: Api, chatId: number, game: GameRow, caption: string): Promise<void> {
    const s = svc.settings(chatId);
    await cleanupOldBoards(api, chatId);
    const ids: number[] = [];
    if (s.render === 'image') {
      const buf = renderBoardImage(game);
      ids.push((await api.sendPhoto(chatId, new InputFile(buf, 'board.png'), { caption })).message_id);
    } else if (s.render === 'sticker') {
      ids.push((await api.sendSticker(chatId, new InputFile(renderBoardSticker(game), 'board.webp'))).message_id);
      if (game.status === 'active' && game.guesses.length > 0) {
        ids.push((await api.sendSticker(chatId, new InputFile(renderKeyboardSticker(game), 'keyboard.webp'))).message_id);
      }
      if (caption) ids.push((await api.sendMessage(chatId, caption)).message_id);
    } else {
      ids.push((await api.sendMessage(chatId, `${caption}\n\n${textBoard(game)}`)).message_id);
    }
    if (game.status === 'active') boardMsgs.set(chatId, ids);
    else boardMsgs.delete(chatId);
  }

  /** "Your turn" message after a tournament board — a real @mention when pings are on. */
  async function sendTurnPing(chatId: number, player: { userId: number; userName: string }, prefix: string): Promise<void> {
    const s = svc.settings(chatId);
    try {
      const msg = s.pings
        ? await bot.api.sendMessage(
            chatId,
            `${prefix} <a href="tg://user?id=${player.userId}">${escapeHtml(player.userName)}</a>!`,
            { parse_mode: 'HTML' }
          )
        : await bot.api.sendMessage(chatId, `${prefix} ${player.userName}!`);
      boardMsgs.get(chatId)?.push(msg.message_id);
    } catch {
      // pings are cosmetic; never fail the game flow over them
    }
  }

  /** Pretty lobby (styled buttons + custom emoji); falls back to the plain version if rejected. */
  async function sendLobby(ctx: Context, t: TournamentRow): Promise<void> {
    try {
      await ctx.reply(lobbyTextHtml(t), { parse_mode: 'HTML', reply_markup: lobbyKeyboardStyled(t) });
    } catch {
      await ctx.reply(lobbyTextPlain(t), { reply_markup: lobbyKeyboardPlain(t) });
    }
  }

  async function editLobby(ctx: Context, t: TournamentRow, started = false): Promise<void> {
    const suffix = started ? '\n\n✅ Started!' : '';
    try {
      await ctx.editMessageText(lobbyTextHtml(t) + suffix, {
        parse_mode: 'HTML',
        reply_markup: started ? undefined : lobbyKeyboardStyled(t),
      });
    } catch {
      await ctx
        .editMessageText(lobbyTextPlain(t) + suffix, { reply_markup: started ? undefined : lobbyKeyboardPlain(t) })
        .catch(() => {});
    }
  }

  // ---------- disband flow: never let an abandoned game lock the chat ----------

  function describeBlocker(chatId: number): string | null {
    const t = svc.openTournament(chatId);
    if (t && t.status === 'joining') {
      return `🏆 A tournament lobby is open — ${t.players.length} player${t.players.length === 1 ? '' : 's'}, last activity ${timeAgo(t.last_activity)}.`;
    }
    if (t && t.status === 'active') {
      return `🏆 A tournament is in progress — round ${t.current_round}/${t.rounds}, last activity ${timeAgo(t.last_activity)}.`;
    }
    const g = svc.activeGame(chatId);
    if (g) {
      const last = g.guesses[g.guesses.length - 1];
      const activity = last ? `last guess ${timeAgo(last.ts)} by ${last.userName}` : `started ${timeAgo(g.started_at)}, no guesses yet`;
      return `🎮 A game is in progress — ${g.guesses.length}/${maxGuessesFor(g)} guesses, ${activity}.`;
    }
    return null;
  }

  /** If something blocks the chat, show what it is + a disband button. Returns true when blocked. */
  async function offerDisband(ctx: Context, action: string): Promise<boolean> {
    const desc = describeBlocker(ctx.chat!.id);
    if (!desc) return false;
    await ctx.reply(`${desc}\n\nDisband it and start fresh?`, {
      reply_markup: new InlineKeyboard()
        .text('🗑 Disband & start new', `disband:${action}`)
        .text('✋ Keep it', 'disband:keep'),
    });
    return true;
  }

  async function startNewGameFlow(api: Api, chatId: number): Promise<boolean> {
    const game = svc.startGame(chatId);
    if (!game) return false;
    const s = svc.settings(chatId);
    const hint = s.bareWord ? 'Type any 5-letter word to guess.' : 'Guess with /guess WORD.';
    await sendBoard(api, chatId, game, `🎮 New game! I picked a 5-letter word — you have ${MAX_GUESSES} tries. ${hint}`);
    return true;
  }

  /** Send a tile-rendered hint; if Telegram rejects the custom emoji, resend with plain tiles. */
  async function replyTiles(ctx: Context, render: (pack: EmojiPackConfig | null) => string): Promise<void> {
    const pack = resolveEmojiPack(svc.settings(ctx.chat!.id).emojiPack);
    if (pack) {
      try {
        await ctx.reply(render(pack), { parse_mode: 'HTML' });
        return;
      } catch {
        // bot may not be allowed to send these custom emoji — fall back below
      }
    }
    await ctx.reply(render(null), { parse_mode: 'HTML' });
  }

  async function handleGuess(ctx: Context, word: string, opts: { silentNoGame?: boolean } = {}): Promise<void> {
    const chatId = ctx.chat!.id;
    const user = userRef(ctx);
    const out = svc.submitGuess(chatId, user, word);

    // fails-forfeit moved the turn to the next player — restart their clock
    if ('failInfo' in out && out.failInfo?.forfeited) scheduleTurnTimers(chatId);

    const withFails = (
      msg: string,
      failInfo?: { count: number; max: number; forfeited: boolean; lockedOut: boolean; nextPlayer: { userName: string } | null },
      html = false
    ) => {
      if (!failInfo) return msg;
      msg += `\n(${failInfo.count}/${failInfo.max} failed attempts)`;
      if (failInfo.forfeited && failInfo.nextPlayer) {
        const name = html ? escapeHtml(failInfo.nextPlayer.userName) : failInfo.nextPlayer.userName;
        msg += `\n🚷 Turn forfeited! Next up: ${name}`;
      }
      if (failInfo.lockedOut) {
        msg += `\n🚷 That was your last attempt — you're out for the rest of this game!`;
      }
      return msg;
    };

    switch (out.type) {
      case 'no_game':
        if (!opts.silentNoGame) await ctx.reply('No game running here. Send /play to start one!');
        return;
      case 'not_a_word':
        await ctx.reply(withFails(`🤔 "${out.word.toUpperCase()}" is not in my dictionary.`, out.failInfo));
        return;
      case 'already_guessed': {
        const game = svc.activeGame(chatId)!;
        await replyTiles(ctx, (pack) => withFails(alreadyGuessedText(out.word, game.answer, pack), out.failInfo, true));
        return;
      }
      case 'creativity_blocked':
        await ctx.reply(withFails(`🚫 Creativity mode: ${out.word.toUpperCase()} was used recently here. Try something fresh!`, out.failInfo));
        return;
      case 'hard_mode_violation':
        await replyTiles(ctx, (pack) => withFails(hardModeViolationText(out.violation, out.superHard, pack), out.failInfo, true));
        return;
      case 'locked_out':
        await ctx.reply(`🚷 ${user.name}, you've used all ${out.max} failed attempts — sit this game out.`);
        return;
      case 'not_your_turn':
        await ctx.reply(`⏳ Not so fast — it's ${out.currentPlayer.userName}'s turn.`);
        return;
    }

    const { game, guessNumber, solved, lost, tournament, duel } = out;
    const maxTries = maxGuessesFor(game);
    const lines: string[] = [];

    // a small reaction on the decisive guess message
    const guessMsgId = ctx.message?.message_id;
    if (guessMsgId && (solved || lost)) {
      ctx.api
        .setMessageReaction(chatId, guessMsgId, [{ type: 'emoji', emoji: solved ? '🎉' : '😱' }])
        .catch(() => {});
    }

    if (solved) {
      lines.push(`🎉 ${user.name} got it in ${guessNumber}/${maxTries} — the word was ${game.answer.toUpperCase()}!`);
    } else if (lost) {
      if (duel) lines.push(`💀 Out of guesses! The word stays secret until your opponent finishes.`);
      else lines.push(`💀 Out of guesses! The word was ${game.answer.toUpperCase()}.`);
    } else {
      lines.push(`${user.name} guessed ${out.game.guesses[guessNumber - 1].word.toUpperCase()} — ${guessNumber}/${maxTries} tries used.`);
    }

    if (tournament) {
      const { t, pointsAwarded, roundEnded, tournamentEnded, nextGame, nextPlayer, winners } = tournament;
      if (tournamentEnded) clearTurnTimers(chatId);
      else scheduleTurnTimers(chatId);
      if (pointsAwarded > 0) lines.push(`🏅 +${pointsAwarded} pts for ${user.name}!`);
      await sendBoard(ctx.api, chatId, game, lines.join('\n'));
      if (!roundEnded && nextPlayer) await sendTurnPing(chatId, nextPlayer, '👉 Your turn,');

      if (tournamentEnded) {
        const winnerNames = winners.map((w) => w.userName).join(' & ');
        await ctx.reply(
          `🏆 Tournament over!\n\n${standingsText(t)}\n\n👑 Winner${winners.length > 1 ? 's' : ''}: ${winnerNames}`
        );
      } else if (roundEnded && nextGame && nextPlayer) {
        await sendBoard(
          ctx.api,
          chatId,
          nextGame,
          `🏆 Round ${t.current_round}/${t.rounds} — new word!\nStandings so far:\n${standingsText(t)}\n\nTurn order: ${turnOrderText(t)}`
        );
        await sendTurnPing(chatId, nextPlayer, '👉 You go first,');
      }
      return;
    }

    if (duel) {
      await sendBoard(ctx.api, chatId, game, lines.join('\n'));
      const { d, finished, bothDone } = duel;
      if (finished && !bothDone) {
        await ctx.reply('⚔️ Your board is done! I will announce the result once your opponent finishes.');
      }
      if (bothDone) {
        const winner = svc.duelWinner(d);
        const describe = (p: typeof d.challenger) =>
          p.solved ? `${p.userName}: solved in ${p.guesses}/${MAX_GUESSES} (${humanMs(p.ms!)})` : `${p.userName}: failed`;
        const verdict =
          winner === 'draw' ? "🤝 It's a draw!" : `👑 ${(winner as { userName: string }).userName} wins the duel!`;
        const summary = `⚔️ Duel finished! The word was ${d.answer.toUpperCase()}.\n\n${describe(d.challenger)}\n${describe(d.opponent!)}\n\n${verdict}`;
        await ctx.reply(summary);
        await ctx.api.sendMessage(d.chat_id, summary).catch(() => {});
      }
      return;
    }

    await sendBoard(ctx.api, chatId, game, lines.join('\n'));
    if (game.kind === 'daily' && (solved || lost)) {
      await ctx.reply(dailyShareText(game));
    }
    if ((solved || lost) && svc.settings(chatId).breakdown) {
      try {
        let text = breakdownText(game, analyzeGame(game));
        const def = await fetchDefinition(game.answer, game.lang);
        if (def) text += `\n\n${def}`;
        await ctx.reply(text);
      } catch {
        // the breakdown is a bonus — never let it break the game flow
      }
    }
  }

  // ---------- commands ----------

  bot.command('start', async (ctx) => {
    const payload = (ctx.match ?? '').trim();
    if (payload.startsWith('duel_')) {
      const duelId = parseInt(payload.slice(5), 10);
      if (ctx.chat.type !== 'private' || !Number.isFinite(duelId)) return;
      const res = svc.acceptDuel(duelId, ctx.chat.id, userRef(ctx));
      if (res === 'not_found') return void (await ctx.reply('This duel no longer exists or is already finished.'));
      if (res === 'full') return void (await ctx.reply('This duel already has two players.'));
      if (res === 'already_playing') return void (await ctx.reply('You already played your board for this duel.'));
      if (res === 'own_game_running') return void (await ctx.reply('Finish your current game here first (/giveup to abandon it).'));
      await ctx.reply('⚔️ Duel on! Same word as your opponent, 6 tries. Just type your 5-letter guesses.');
      await sendBoard(ctx.api, ctx.chat.id, res.game, 'Your duel board:');
      return;
    }
    await ctx.reply(HELP_TEXT);
  });

  bot.command('help', (ctx) => ctx.reply(HELP_TEXT));

  bot.command('play', async (ctx) => {
    if (await offerDisband(ctx, 'play')) return;
    await startNewGameFlow(ctx.api, ctx.chat.id);
  });

  bot.command(['guess', 'w'], async (ctx) => {
    const word = (ctx.match ?? '').trim();
    if (!looksLikeGuess(word)) {
      return void (await ctx.reply('Usage: /guess WORD or /w WORD (a 5-letter word, e.g. /w crane)'));
    }
    await handleGuess(ctx, word);
  });

  bot.command('usepack', async (ctx) => {
    const requestedName = (ctx.match ?? '').trim();
    if (!requestedName) {
      return void (await ctx.reply('Usage: /usepack NAME — a custom emoji pack name or t.me/addemoji/... link.\n/usepack off removes the current pack.'));
    }
    if (requestedName.toLowerCase() === 'off') {
      const s = svc.settings(ctx.chat.id);
      s.emojiPack = null;
      svc.saveSettings(ctx.chat.id, s);
      return void (await ctx.reply('✅ Emoji pack reset — hint messages use the default tiles again.'));
    }

    let lastError: unknown = null;
    for (const packName of packNameCandidates(requestedName, ctx.me.username)) {
      try {
        const stickerSet = await ctx.api.getStickerSet(packName);
        if (stickerSet.sticker_type !== 'custom_emoji') {
          return void (await ctx.reply(`${packName} is not a custom emoji pack.`));
        }
        const s = svc.settings(ctx.chat.id);
        s.emojiPack = emojiPackFromStickers(packName, stickerSet.stickers);
        svc.saveSettings(ctx.chat.id, s);
        return void (await ctx.reply(`✅ Custom emoji pack enabled!\nPack: https://t.me/addemoji/${packName}`));
      } catch (error) {
        lastError = error;
      }
    }
    const message = lastError instanceof Error ? lastError.message : String(lastError);
    await ctx.reply(`Could not use that emoji pack: ${message}`);
  });

  bot.command('board', async (ctx) => {
    const chatId = ctx.chat.id;
    const game = svc.activeGame(chatId);
    const t = svc.openTournament(chatId);
    if (!game) {
      if (t && t.status === 'joining') return void (await sendLobby(ctx, t));
      return void (await ctx.reply('No active game. Send /play to start one!'));
    }
    let caption = `Current board — ${game.guesses.length}/${MAX_GUESSES} guesses used.`;
    if (t && t.status === 'active') {
      const current = roundOrder(t.players, t.current_round)[t.turn_idx % t.players.length];
      caption += `\n\n🏆 Round ${t.current_round}/${t.rounds} — ${current.userName}'s turn.\nStandings:\n${standingsText(t)}`;
    }
    await sendBoard(ctx.api, chatId, game, caption);
  });

  bot.command('giveup', async (ctx) => {
    const res = svc.giveUp(ctx.chat.id);
    if (!res) return void (await ctx.reply('No active game to give up.'));
    if (res.tournamentCancelled) clearTurnTimers(ctx.chat.id);
    let msg = `🏳️ Game over — the word was ${res.answer.toUpperCase()}.`;
    if (res.tournamentCancelled) msg += '\nThe tournament was cancelled.';
    await ctx.reply(msg);
  });

  bot.command('stats', async (ctx) => {
    const user = userRef(ctx);
    const row = svc.statsFor(ctx.chat.id, user.id);
    await ctx.reply(statsText(row, user.name));
  });

  bot.command('top', async (ctx) => {
    await ctx.reply(topText(getChatStats(db, ctx.chat.id)));
  });

  bot.command('hint', async (ctx) => {
    if (!svc.settings(ctx.chat.id).hints) {
      return void (await ctx.reply('Hints are disabled here. Enable with /settings hints on.'));
    }
    const res = svc.useHint(ctx.chat.id);
    switch (res.type) {
      case 'no_game':
        return void (await ctx.reply('No game running here. Send /play to start one!'));
      case 'not_here':
        return void (await ctx.reply('No hints in tournaments or duels — that would be too easy!'));
      case 'no_tries':
        return void (await ctx.reply('Not enough tries left to afford a hint (it costs one).'));
      case 'nothing_to_reveal':
        return void (await ctx.reply('Nothing left to reveal — your guesses already touched every letter of the word!'));
      case 'ok':
        return void (await ctx.reply(
          `💡 The word contains the letter ${res.letter.toUpperCase()}!\nThat cost one try — ${res.triesLeft} left.`
        ));
    }
  });

  bot.command('history', async (ctx) => {
    await ctx.reply(historyText(recentFinishedGames(db, ctx.chat.id)));
  });

  bot.command('vs', async (ctx) => {
    const chatId = ctx.chat.id;
    const me = userRef(ctx);
    const repliedTo = ctx.message?.reply_to_message?.from;
    let other: { id: number; name: string } | null = null;

    if (repliedTo && !repliedTo.is_bot) {
      other = { id: repliedTo.id, name: [repliedTo.first_name, repliedTo.last_name].filter(Boolean).join(' ') };
    } else {
      const arg = (ctx.match ?? '').trim().toLowerCase();
      if (arg) {
        const match = getChatStats(db, chatId).find((s) => s.name.toLowerCase().includes(arg));
        if (match) other = { id: match.user_id, name: match.name };
      }
    }
    if (!other) {
      return void (await ctx.reply('Reply to someone with /vs, or use /vs NAME (a name from /top).'));
    }
    if (other.id === me.id) return void (await ctx.reply('🪞 You vs you would end in a draw.'));

    const duels = finishedDuels(db, chatId).filter(
      (d) =>
        d.opponent &&
        [d.challenger.userId, d.opponent.userId].includes(me.id) &&
        [d.challenger.userId, d.opponent.userId].includes(other.id)
    );
    const record = { aWins: 0, bWins: 0, draws: 0 };
    for (const d of duels) {
      const winner = svc.duelWinner(d);
      if (winner === 'draw' || !winner) record.draws++;
      else if (winner.userId === me.id) record.aWins++;
      else record.bWins++;
    }
    await ctx.reply(vsText(svc.statsFor(chatId, me.id), svc.statsFor(chatId, other.id), me.name, other.name, record));
  });

  bot.command('define', async (ctx) => {
    const [last] = recentFinishedGames(db, ctx.chat.id, 1);
    if (!last) return void (await ctx.reply('No finished games yet — definitions come after a game ends.'));
    const def = await fetchDefinition(last.answer, last.lang);
    await ctx.reply(def ?? `📖 No definition found for ${last.answer.toUpperCase()} (English words only for now).`);
  });

  bot.command('daily', async (ctx) => {
    const chatId = ctx.chat.id;
    const arg = (ctx.match ?? '').trim().toLowerCase();

    if (arg === 'off') {
      const s = svc.settings(chatId);
      s.dailyTime = null;
      svc.saveSettings(chatId, s);
      return void (await ctx.reply('☀️ Daily auto-post disabled. /daily still works manually.'));
    }
    const time = arg.match(/^(\d{1,2}):(\d{2})$/);
    if (time) {
      const hh = parseInt(time[1], 10);
      const mm = parseInt(time[2], 10);
      if (hh > 23 || mm > 59) return void (await ctx.reply('Time must be HH:MM, 24-hour.'));
      const s = svc.settings(chatId);
      s.dailyTime = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
      svc.saveSettings(chatId, s);
      return void (await ctx.reply(`☀️ Daily puzzle will be auto-posted here at ${s.dailyTime} (server time).`));
    }
    if (arg) {
      return void (await ctx.reply('Usage: /daily — play today · /daily 09:00 — auto-post time · /daily off'));
    }

    const res = svc.startDaily(chatId, todayStr());
    if (res === 'busy') {
      await offerDisband(ctx, 'daily');
      return;
    }
    if (res === 'done') {
      const g = svc.dailyGame(chatId, todayStr())!;
      return void (await ctx.reply(`This chat already finished today's daily!\n\n${dailyShareText(g)}`));
    }
    const caption = res.created
      ? `☀️ Daily puzzle — ${todayStr()}. Same word for everyone today, 6 tries. Streaks are on the line!`
      : `☀️ Today's daily — ${res.game.guesses.length}/${MAX_GUESSES} guesses used.`;
    await sendBoard(ctx.api, chatId, res.game, caption);
  });

  bot.command('settings', async (ctx) => {
    const chatId = ctx.chat.id;
    const args = (ctx.match ?? '').trim();
    if (args) {
      const toggle = args.match(/^(cleanup|hints|pings|breakdown)\s+(on|off)$/i);
      if (toggle) {
        const key = toggle[1].toLowerCase() as 'cleanup' | 'hints' | 'pings' | 'breakdown';
        const value = toggle[2].toLowerCase() === 'on';
        const s = svc.settings(chatId);
        s[key] = value;
        svc.saveSettings(chatId, s);
        const labels = {
          cleanup: 'Board cleanup (delete old boards)',
          hints: 'Hints (/hint trades a try for a letter)',
          pings: 'Turn @pings',
          breakdown: 'Post-game breakdown',
        };
        return void (await ctx.reply(`${value ? '✅' : '🚫'} ${labels[key]}: ${value ? 'ON' : 'OFF'}`));
      }
      const turn = args.match(/^turntime\s+(.+)$/i);
      if (turn) {
        const v = turn[1].trim().toLowerCase();
        const secs = v === 'off' ? 0 : parseDuration(v);
        if (secs === null || secs > 86400) {
          return void (await ctx.reply('Examples: /settings turntime 90s | 2m | 5m | off'));
        }
        const s = svc.settings(chatId);
        s.turnTime = secs;
        svc.saveSettings(chatId, s);
        if (secs > 0) scheduleTurnTimers(chatId);
        else clearTurnTimers(chatId);
        return void (await ctx.reply(
          secs > 0
            ? `⏱ Tournament turn timer: ${humanDuration(secs)} per turn (warning at halftime).`
            : '⏱ Turn timer disabled.'
        ));
      }
      const lang = args.match(/^lang(?:uage)?\s+(\w+)$/i);
      if (lang) {
        const code = lang[1].toLowerCase();
        if (!LANGUAGES[code]) {
          return void (await ctx.reply(`Unknown language. Available: ${Object.keys(LANGUAGES).join(', ')}`));
        }
        const s = svc.settings(chatId);
        s.language = code;
        svc.saveSettings(chatId, s);
        return void (await ctx.reply(`${LANGUAGES[code].label} — new games here use the ${code.toUpperCase()} word list.`));
      }
      const fails = args.match(/^fails?\s+(\d+|off|unlimited)$/i);
      if (fails) {
        const s = svc.settings(chatId);
        const v = fails[1].toLowerCase();
        const n = v === 'off' || v === 'unlimited' ? 0 : parseInt(v, 10);
        if (n < 0 || n > 100) return void (await ctx.reply('Pick a limit between 1 and 100, or "off".'));
        s.maxFails = n;
        svc.saveSettings(chatId, s);
        return void (await ctx.reply(
          n > 0
            ? `✅ Tournaments: ${n} failed attempt${n > 1 ? 's' : ''} per turn, then the turn is forfeited.`
            : '✅ Tournaments: unlimited failed attempts per turn.'
        ));
      }
      const m = args.match(/^creativity\s+(.+)$/i);
      if (!m) return void (await ctx.reply('Usage: /settings creativity 30m  |  /settings creativity 15 words  |  /settings fails 5'));
      const parsed = parseCreativityValue(m[1]);
      if (!parsed) return void (await ctx.reply('Could not parse that. Examples: 90s, 30m, 2h, 1d, 15 words'));
      const s = svc.settings(chatId);
      s.creativity.enabled = true;
      if ('seconds' in parsed) {
        s.creativity.mode = 'time';
        s.creativity.seconds = parsed.seconds;
      } else {
        s.creativity.mode = 'count';
        s.creativity.count = parsed.count;
      }
      svc.saveSettings(chatId, s);
      const desc =
        'seconds' in parsed ? `words from the last ${humanDuration(parsed.seconds)}` : `the last ${parsed.count} words`;
      return void (await ctx.reply(`✅ Creativity mode is ON — ${desc} are banned from guesses and answers.`));
    }
    await ctx.reply(settingsText(svc.settings(chatId)), { reply_markup: settingsKeyboard(svc, chatId) });
  });

  bot.command('tournament', async (ctx) => {
    const chatId = ctx.chat.id;
    const arg = (ctx.match ?? '').trim().toLowerCase();
    if (arg === 'cancel') {
      const res = svc.cancelTournament(chatId, ctx.from!.id);
      if (!res) return void (await ctx.reply('No open tournament here.'));
      if (res === 'not_allowed') return void (await ctx.reply('Only the tournament creator can cancel it.'));
      clearTurnTimers(chatId);
      return void (await ctx.reply('🏳️ Tournament cancelled.'));
    }
    const existing = svc.openTournament(chatId);
    if (existing) {
      if (existing.status === 'joining')
        return void (await sendLobby(ctx, existing));
      return void (await ctx.reply(`🏆 Tournament in progress — round ${existing.current_round}/${existing.rounds}.\nStandings:\n${standingsText(existing)}`));
    }
    const rounds = parseInt(arg, 10);
    if (!Number.isFinite(rounds) || rounds < 1 || rounds > 25) {
      return void (await ctx.reply('Usage: /tournament N — start a tournament of N rounds (1–25), e.g. /tournament 3'));
    }
    if (svc.activeGame(chatId)) {
      await offerDisband(ctx, `t${rounds}`);
      return;
    }
    const t = svc.createTournament(chatId, rounds, userRef(ctx));
    if (!t) return void (await ctx.reply('Could not create a tournament right now.'));
    await sendLobby(ctx, t);
  });

  bot.command('challenge', async (ctx) => {
    if (ctx.chat.type === 'private') {
      return void (await ctx.reply('Use /challenge in a group — that is where I announce the winner!'));
    }
    const user = userRef(ctx);
    const d = svc.createDuel(ctx.chat.id, user);
    const link = `https://t.me/${ctx.me.username}?start=duel_${d.id}`;
    await ctx.reply(
      `⚔️ ${user.name} challenges the chat to a duel!\n\nSame secret word for both players, ${MAX_GUESSES} tries each in a private chat with me. Fewest guesses wins; speed breaks ties.\n\nFirst person to tap becomes the opponent. ${user.name}, tap too to play your board!`,
      { reply_markup: new InlineKeyboard().url('⚔️ Play the duel', link) }
    );
  });

  // ---------- callbacks ----------

  bot.callbackQuery(/^set:(bare|render|creativity|difficulty)$/, async (ctx) => {
    const chatId = ctx.chat!.id;
    const s = svc.settings(chatId);
    const which = ctx.match[1];
    if (which === 'bare') s.bareWord = !s.bareWord;
    if (which === 'render') s.render = s.render === 'image' ? 'sticker' : s.render === 'sticker' ? 'text' : 'image';
    if (which === 'creativity') s.creativity.enabled = !s.creativity.enabled;
    if (which === 'difficulty') {
      s.difficulty = s.difficulty === 'normal' ? 'hard' : s.difficulty === 'hard' ? 'superhard' : 'normal';
    }
    svc.saveSettings(chatId, s);
    await ctx.editMessageText(settingsText(s), { reply_markup: settingsKeyboard(svc, chatId) });
    await ctx.answerCallbackQuery('Saved!');
  });

  bot.callbackQuery(/^disband:(.+)$/, async (ctx) => {
    const action = ctx.match[1];
    const chatId = ctx.chat!.id;
    if (action === 'keep') {
      await ctx.answerCallbackQuery('Keeping it!');
      await ctx.deleteMessage().catch(() => {});
      return;
    }
    const res = svc.disbandBlocking(chatId);
    clearTurnTimers(chatId);
    boardMsgs.delete(chatId);
    await ctx.answerCallbackQuery(res ? 'Disbanded!' : 'Nothing left to disband.');
    await ctx.deleteMessage().catch(() => {});
    if (res) {
      let msg = res.tournamentCancelled ? '🗑 Tournament disbanded.' : '🗑 Game disbanded.';
      if (res.answer) msg += ` The word was ${res.answer.toUpperCase()}.`;
      await ctx.api.sendMessage(chatId, msg).catch(() => {});
    }

    if (action === 'play') {
      await startNewGameFlow(ctx.api, chatId);
    } else if (action === 'daily') {
      const r = svc.startDaily(chatId, todayStr());
      if (r === 'done') {
        await ctx.api.sendMessage(chatId, "Today's daily was already finished here.").catch(() => {});
      } else if (r !== 'busy') {
        await sendBoard(
          ctx.api,
          chatId,
          r.game,
          `☀️ Daily puzzle — ${todayStr()}. Same word for everyone today, 6 tries. Streaks are on the line!`
        );
      }
    } else if (/^t\d+$/.test(action)) {
      const t = svc.createTournament(chatId, parseInt(action.slice(1), 10), userRef(ctx));
      if (t) await sendLobby(ctx, t);
    }
  });

  bot.callbackQuery(/^t:join:(\d+)$/, async (ctx) => {
    const res = svc.joinTournament(parseInt(ctx.match[1], 10), userRef(ctx));
    if (!res || res === 'closed') return void (await ctx.answerCallbackQuery('This tournament is not open for joining.'));
    if (res === 'already_in') return void (await ctx.answerCallbackQuery('You are already in!'));
    await editLobby(ctx, res);
    await ctx.answerCallbackQuery('Joined! 🏆');
  });

  bot.callbackQuery(/^t:quit:(\d+)$/, async (ctx) => {
    const res = svc.quitTournament(parseInt(ctx.match[1], 10), ctx.from.id);
    if (!res || res === 'closed') return void (await ctx.answerCallbackQuery('This tournament can no longer be left.'));
    if (res === 'not_in') return void (await ctx.answerCallbackQuery('You are not in this tournament.'));
    await editLobby(ctx, res);
    await ctx.answerCallbackQuery('You left the tournament.');
  });

  bot.callbackQuery(/^t:start:(\d+)$/, async (ctx) => {
    const id = parseInt(ctx.match[1], 10);
    const t = svc.openTournament(ctx.chat!.id);
    if (!t || t.id !== id) return void (await ctx.answerCallbackQuery('This tournament is no longer open.'));
    if (t.created_by !== ctx.from.id) return void (await ctx.answerCallbackQuery('Only the creator can start it.'));
    const res = svc.startTournament(id);
    if (res === 'too_few') return void (await ctx.answerCallbackQuery('Need at least 2 players!'));
    if (!res) return void (await ctx.answerCallbackQuery('Could not start the tournament.'));
    await ctx.answerCallbackQuery('Game on!');
    await editLobby(ctx, res.t, true);
    const s = svc.settings(ctx.chat!.id);
    const hint = s.bareWord ? 'type any 5-letter word' : 'use /guess WORD';
    const timerNote = s.turnTime > 0 ? ` ⏱ ${humanDuration(s.turnTime)} per turn.` : '';
    await sendBoard(
      ctx.api,
      ctx.chat!.id,
      res.game,
      `🏆 Round 1/${res.t.rounds} — the word is set!\nTurn order: ${turnOrderText(res.t)} (${hint}).${timerNote}`
    );
    await sendTurnPing(ctx.chat!.id, res.firstPlayer, '👉 You go first,');
    scheduleTurnTimers(ctx.chat!.id);
  });

  // ---------- bare-word guessing ----------

  bot.on('message:text', async (ctx) => {
    const text = ctx.message.text.trim();
    if (text.startsWith('/')) return;
    if (!looksLikeGuess(text)) return;
    const isPrivate = ctx.chat.type === 'private';
    if (!isPrivate && !svc.settings(ctx.chat.id).bareWord) return;
    await handleGuess(ctx, text, { silentNoGame: true });
  });
}
