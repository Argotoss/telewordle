import type Database from 'better-sqlite3';
import { Bot, Context, InlineKeyboard, InputFile } from 'grammy';
import { GameRow, TournamentRow } from '../db.js';
import { GameService, MAX_GUESSES, UserRef, roundOrder } from '../game/service.js';
import { emojiPackFromStickers, escapeHtml, packNameCandidates } from '../render/emoji-pack.js';
import { renderBoardImage, renderBoardSticker, renderKeyboardSticker } from '../render/image.js';
import { textBoard } from '../render/text.js';
import {
  DIFFICULTY_LABEL,
  HELP_TEXT,
  RENDER_LABEL,
  alreadyGuessedText,
  hardModeViolationText,
  humanDuration,
  humanMs,
  parseCreativityValue,
  settingsText,
  standingsText,
  statsText,
  turnOrderText,
} from './format.js';

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

function lobbyText(t: TournamentRow): string {
  const names = t.players.map((p) => p.userName).join(', ');
  return `🏆 Tournament — ${t.rounds} round${t.rounds > 1 ? 's' : ''}
Players (${t.players.length}): ${names}

Turn-based: players guess in order, the order rotates every round.
Scoring: word solved on guess #1 = 6 pts … guess #6 = 1 pt.

Tap Join to enter, then the creator taps Start.`;
}

function lobbyKeyboard(t: TournamentRow): InlineKeyboard {
  return new InlineKeyboard()
    .text('✋ Join', `t:join:${t.id}`)
    .text('▶️ Start', `t:start:${t.id}`)
    .row()
    .text('🚪 Quit', `t:quit:${t.id}`);
}

export function registerHandlers(bot: Bot, db: Database.Database): void {
  const svc = new GameService(db);

  async function sendBoard(ctx: Context, chatId: number, game: GameRow, caption: string): Promise<void> {
    const s = svc.settings(chatId);
    if (s.render === 'image') {
      const buf = renderBoardImage(game);
      await ctx.api.sendPhoto(chatId, new InputFile(buf, 'board.png'), { caption });
    } else if (s.render === 'sticker') {
      await ctx.api.sendSticker(chatId, new InputFile(renderBoardSticker(game), 'board.webp'));
      if (game.status === 'active' && game.guesses.length > 0) {
        await ctx.api.sendSticker(chatId, new InputFile(renderKeyboardSticker(game), 'keyboard.webp'));
      }
      if (caption) await ctx.api.sendMessage(chatId, caption);
    } else {
      await ctx.api.sendMessage(chatId, `${caption}\n\n${textBoard(game)}`);
    }
  }

  async function handleGuess(ctx: Context, word: string, opts: { silentNoGame?: boolean } = {}): Promise<void> {
    const chatId = ctx.chat!.id;
    const user = userRef(ctx);
    const out = svc.submitGuess(chatId, user, word);

    const withFails = (
      msg: string,
      failInfo?: { count: number; max: number; forfeited: boolean; nextPlayer: { userName: string } | null },
      html = false
    ) => {
      if (!failInfo) return msg;
      msg += `\n(${failInfo.count}/${failInfo.max} failed attempts this turn)`;
      if (failInfo.forfeited && failInfo.nextPlayer) {
        const name = html ? escapeHtml(failInfo.nextPlayer.userName) : failInfo.nextPlayer.userName;
        msg += `\n🚷 Turn forfeited! Next up: ${name}`;
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
        const pack = svc.settings(chatId).emojiPack;
        await ctx.reply(withFails(alreadyGuessedText(out.word, game.answer, pack), out.failInfo, true), {
          parse_mode: 'HTML',
        });
        return;
      }
      case 'creativity_blocked':
        await ctx.reply(withFails(`🚫 Creativity mode: ${out.word.toUpperCase()} was used recently here. Try something fresh!`, out.failInfo));
        return;
      case 'hard_mode_violation': {
        const pack = svc.settings(chatId).emojiPack;
        await ctx.reply(withFails(hardModeViolationText(out.violation, out.superHard, pack), out.failInfo, true), {
          parse_mode: 'HTML',
        });
        return;
      }
      case 'not_your_turn':
        await ctx.reply(`⏳ Not so fast — it's ${out.currentPlayer.userName}'s turn.`);
        return;
    }

    const { game, guessNumber, solved, lost, tournament, duel } = out;
    const lines: string[] = [];

    if (solved) {
      lines.push(`🎉 ${user.name} got it in ${guessNumber}/${MAX_GUESSES} — the word was ${game.answer.toUpperCase()}!`);
    } else if (lost) {
      if (duel) lines.push(`💀 Out of guesses! The word stays secret until your opponent finishes.`);
      else lines.push(`💀 Out of guesses! The word was ${game.answer.toUpperCase()}.`);
    } else {
      lines.push(`${user.name} guessed ${out.game.guesses[guessNumber - 1].word.toUpperCase()} — ${guessNumber}/${MAX_GUESSES} tries used.`);
    }

    if (tournament) {
      const { t, pointsAwarded, roundEnded, tournamentEnded, nextGame, nextPlayer, winners } = tournament;
      if (pointsAwarded > 0) lines.push(`🏅 +${pointsAwarded} pts for ${user.name}!`);
      if (!roundEnded && nextPlayer) lines.push(`Next up: ${nextPlayer.userName}`);
      await sendBoard(ctx, chatId, game, lines.join('\n'));

      if (tournamentEnded) {
        const winnerNames = winners.map((w) => w.userName).join(' & ');
        await ctx.reply(
          `🏆 Tournament over!\n\n${standingsText(t)}\n\n👑 Winner${winners.length > 1 ? 's' : ''}: ${winnerNames}`
        );
      } else if (roundEnded && nextGame && nextPlayer) {
        await sendBoard(
          ctx,
          chatId,
          nextGame,
          `🏆 Round ${t.current_round}/${t.rounds} — new word!\nStandings so far:\n${standingsText(t)}\n\nTurn order: ${turnOrderText(t)}\n${nextPlayer.userName} goes first.`
        );
      }
      return;
    }

    if (duel) {
      await sendBoard(ctx, chatId, game, lines.join('\n'));
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

    await sendBoard(ctx, chatId, game, lines.join('\n'));
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
      await sendBoard(ctx, ctx.chat.id, res.game, 'Your duel board:');
      return;
    }
    await ctx.reply(HELP_TEXT);
  });

  bot.command('help', (ctx) => ctx.reply(HELP_TEXT));

  bot.command('play', async (ctx) => {
    const chatId = ctx.chat.id;
    const t = svc.openTournament(chatId);
    if (t) return void (await ctx.reply('A tournament is open in this chat — finish it or /tournament cancel first.'));
    const game = svc.startGame(chatId);
    if (!game) return void (await ctx.reply('A game is already running! Check /board or /giveup to abandon it.'));
    const s = svc.settings(chatId);
    const hint = s.bareWord
      ? 'Type any 5-letter word to guess.'
      : 'Guess with /guess WORD.';
    await sendBoard(ctx, chatId, game, `🎮 New game! I picked a 5-letter word — you have ${MAX_GUESSES} tries. ${hint}`);
  });

  bot.command(['guess', 'w'], async (ctx) => {
    const word = (ctx.match ?? '').trim();
    if (!/^[a-zA-Z]{5}$/.test(word)) {
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
      return void (await ctx.reply('✅ Emoji pack removed — hint messages use plain emoji again.'));
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
      if (t && t.status === 'joining') return void (await ctx.reply(lobbyText(t), { reply_markup: lobbyKeyboard(t) }));
      return void (await ctx.reply('No active game. Send /play to start one!'));
    }
    let caption = `Current board — ${game.guesses.length}/${MAX_GUESSES} guesses used.`;
    if (t && t.status === 'active') {
      const current = roundOrder(t.players, t.current_round)[t.turn_idx % t.players.length];
      caption += `\n\n🏆 Round ${t.current_round}/${t.rounds} — ${current.userName}'s turn.\nStandings:\n${standingsText(t)}`;
    }
    await sendBoard(ctx, chatId, game, caption);
  });

  bot.command('giveup', async (ctx) => {
    const res = svc.giveUp(ctx.chat.id);
    if (!res) return void (await ctx.reply('No active game to give up.'));
    let msg = `🏳️ Game over — the word was ${res.answer.toUpperCase()}.`;
    if (res.tournamentCancelled) msg += '\nThe tournament was cancelled.';
    await ctx.reply(msg);
  });

  bot.command('stats', async (ctx) => {
    const user = userRef(ctx);
    const row = svc.statsFor(ctx.chat.id, user.id);
    await ctx.reply(statsText(row, user.name));
  });

  bot.command('settings', async (ctx) => {
    const chatId = ctx.chat.id;
    const args = (ctx.match ?? '').trim();
    if (args) {
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
      return void (await ctx.reply('🏳️ Tournament cancelled.'));
    }
    const existing = svc.openTournament(chatId);
    if (existing) {
      if (existing.status === 'joining')
        return void (await ctx.reply(lobbyText(existing), { reply_markup: lobbyKeyboard(existing) }));
      return void (await ctx.reply(`🏆 Tournament in progress — round ${existing.current_round}/${existing.rounds}.\nStandings:\n${standingsText(existing)}`));
    }
    const rounds = parseInt(arg, 10);
    if (!Number.isFinite(rounds) || rounds < 1 || rounds > 25) {
      return void (await ctx.reply('Usage: /tournament N — start a tournament of N rounds (1–25), e.g. /tournament 3'));
    }
    if (svc.activeGame(chatId)) return void (await ctx.reply('Finish the current game first (/giveup to abandon it).'));
    const t = svc.createTournament(chatId, rounds, userRef(ctx));
    if (!t) return void (await ctx.reply('Could not create a tournament right now.'));
    await ctx.reply(lobbyText(t), { reply_markup: lobbyKeyboard(t) });
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

  bot.callbackQuery(/^t:join:(\d+)$/, async (ctx) => {
    const res = svc.joinTournament(parseInt(ctx.match[1], 10), userRef(ctx));
    if (!res || res === 'closed') return void (await ctx.answerCallbackQuery('This tournament is not open for joining.'));
    if (res === 'already_in') return void (await ctx.answerCallbackQuery('You are already in!'));
    await ctx.editMessageText(lobbyText(res), { reply_markup: lobbyKeyboard(res) });
    await ctx.answerCallbackQuery('Joined! 🏆');
  });

  bot.callbackQuery(/^t:quit:(\d+)$/, async (ctx) => {
    const res = svc.quitTournament(parseInt(ctx.match[1], 10), ctx.from.id);
    if (!res || res === 'closed') return void (await ctx.answerCallbackQuery('This tournament can no longer be left.'));
    if (res === 'not_in') return void (await ctx.answerCallbackQuery('You are not in this tournament.'));
    await ctx.editMessageText(lobbyText(res), { reply_markup: lobbyKeyboard(res) });
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
    await ctx.editMessageText(lobbyText(res.t).replace('Tap Join to enter, then the creator taps Start.', '✅ Started!'));
    const s = svc.settings(ctx.chat!.id);
    const hint = s.bareWord ? 'type any 5-letter word' : 'use /guess WORD';
    await sendBoard(
      ctx,
      ctx.chat!.id,
      res.game,
      `🏆 Round 1/${res.t.rounds} — the word is set!\nTurn order: ${turnOrderText(res.t)}\n${res.firstPlayer.userName} goes first (${hint}).`
    );
  });

  // ---------- bare-word guessing ----------

  bot.on('message:text', async (ctx) => {
    const text = ctx.message.text.trim();
    if (text.startsWith('/')) return;
    if (!/^[a-zA-Z]{5}$/.test(text)) return;
    const isPrivate = ctx.chat.type === 'private';
    if (!isPrivate && !svc.settings(ctx.chat.id).bareWord) return;
    await handleGuess(ctx, text, { silentNoGame: true });
  });
}
