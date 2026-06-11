import type Database from 'better-sqlite3';
import { Bot, Context, InlineKeyboard, InputFile } from 'grammy';
import { GameRow, TournamentRow } from '../db.js';
import { GameService, MAX_GUESSES, UserRef, roundOrder } from '../game/service.js';
import { emojiPackFromStickers, escapeHtml, packNameCandidates } from '../render/emoji-pack.js';
import { renderBoardSticker, renderKeyboardSticker } from '../render/image.js';
import {
	HELP_TEXT,
  alreadyGuessedText,
  creativityHelpText,
  giveUpText,
  hardModeViolationText,
  humanDuration,
  humanMs,
  modeHelpText,
  parseCreativityValue,
  settingsText,
  standingsText,
	statsText,
} from './format.js';

const PEOPLE_EMOJI = '<tg-emoji emoji-id="5942877472163892475">👥</tg-emoji>';
const JOIN_EMOJI_ID = '5920090136627908485';
const QUIT_EMOJI_ID = '5922712343011135025';
const START_EMOJI_ID = '5994378304751145264';

type StyledInlineButton = {
	text: string;
	callback_data: string;
	style: 'success' | 'primary' | 'danger';
	icon_custom_emoji_id: string;
};

type StyledInlineKeyboard = {
	inline_keyboard: StyledInlineButton[][];
};

function userRef(ctx: Context): UserRef {
  const u = ctx.from!;
  const name = [u.first_name, u.last_name].filter(Boolean).join(' ') || u.username || 'Player';
  return { id: u.id, name, username: u.username, firstName: u.first_name || u.username || 'Player' };
}

function playerMentionHtml(player: { userId: number; userName: string; username?: string; firstName?: string }): string {
  if (player.username) return `@${player.username}`;
  const label = escapeHtml(player.firstName || player.userName);
  return `<a href="tg://user?id=${player.userId}">${label}</a>`;
}

function playerNameLinkHtml(player: { userId: number; userName: string; firstName?: string }): string {
  const label = escapeHtml(player.firstName || player.userName);
  return `<a href="tg://user?id=${player.userId}">${label}</a>`;
}

function compactStandingsHtml(t: TournamentRow): string {
  const rankLabels = ['🥇', '🥈', '🥉'];
  return [...t.players]
    .map((p) => ({ p, pts: t.scores[String(p.userId)] ?? 0 }))
    .sort((a, b) => b.pts - a.pts)
    .map((r, i) => `${rankLabels[i] ?? String(i + 1)} ${playerNameLinkHtml(r.p)} · ${r.pts}`)
    .join('\n');
}

function roundLabelHtml(t: TournamentRow): string {
  return `🏆 Round ${t.current_round}/${t.rounds}\n\n${compactStandingsHtml(t)}`;
}

function currentTournamentPlayer(t: TournamentRow) {
  const order = roundOrder(t.players, t.current_round);
  return order[t.turn_idx % order.length];
}

function tournamentStatusHtml(t: TournamentRow): string {
  return `${roundLabelHtml(t)}\n\nNext up ${playerMentionHtml(currentTournamentPlayer(t))}`;
}

function lobbyText(t: TournamentRow): string {
  const names = t.players.length > 0 ? t.players.map(playerNameLinkHtml).join(', ') : 'No players';
  const rounds = t.rounds > 0 ? ` · ${t.rounds}` : '';
  return `${PEOPLE_EMOJI} ${names}${rounds}

Players guess in order, ${MAX_GUESSES} max guesses, faster solution gives more points!`;
}

function lobbyKeyboard(t: TournamentRow): StyledInlineKeyboard {
  return {
    inline_keyboard: [
      [
        {
          text: 'Join',
          callback_data: `t:join:${t.id}`,
          style: 'success',
          icon_custom_emoji_id: JOIN_EMOJI_ID,
        },
        {
          text: 'Start',
          callback_data: `t:start:${t.id}`,
          style: 'primary',
          icon_custom_emoji_id: START_EMOJI_ID,
        },
      ],
      [
        {
          text: 'Quit',
          callback_data: `t:quit:${t.id}`,
          style: 'danger',
          icon_custom_emoji_id: QUIT_EMOJI_ID,
        },
      ],
    ],
  };
}

export function registerHandlers(bot: Bot, db: Database.Database): void {
  const svc = new GameService(db);

  type StateMessageOptions = {
    footer?: string;
    footerHtml?: string;
    hideKeyboard?: boolean;
  };

  async function sendStateMessage(
    ctx: Context,
    chatId: number,
    caption: string,
    boardText?: string,
    opts: StateMessageOptions = {}
  ): Promise<void> {
    const textParts = [caption, boardText].filter((part): part is string => Boolean(part));
    const footerParts = [opts.footer].filter((part): part is string => Boolean(part));
    const messageParts = [...textParts, ...footerParts, opts.footerHtml].filter(Boolean);

    if (messageParts.length === 0) return;

    if (opts.footerHtml) {
      const escaped = textParts.map(escapeHtml);
      const escapedFooter = footerParts.map(escapeHtml);
      await ctx.api.sendMessage(chatId, [...escaped, ...escapedFooter, opts.footerHtml].filter(Boolean).join('\n\n'), {
        parse_mode: 'HTML',
      });
      return;
    }

    await ctx.api.sendMessage(chatId, [...textParts, ...footerParts].join('\n\n'));
  }

  async function sendBoard(
    ctx: Context,
    chatId: number,
    game: GameRow,
    caption: string,
    opts: StateMessageOptions = {}
  ): Promise<void> {
    await ctx.api.sendSticker(chatId, new InputFile(renderBoardSticker(game, { alignToKeyboard: !opts.hideKeyboard }), 'board.webp'));
    if (!opts.hideKeyboard) {
      await ctx.api.sendSticker(chatId, new InputFile(renderKeyboardSticker(game), 'keyboard.webp'));
    }
    await sendStateMessage(ctx, chatId, caption, undefined, opts);
  }

  async function handleGuess(ctx: Context, word: string, opts: { silentNoGame?: boolean } = {}): Promise<void> {
    const chatId = ctx.chat!.id;
    const user = userRef(ctx);
    const out = svc.submitGuess(chatId, user, word);

    switch (out.type) {
      case 'no_game':
        if (!opts.silentNoGame) await ctx.reply('No game running here. Send /play to start one!');
        return;
      case 'not_a_word':
        await ctx.reply(`🤔 "${out.word.toUpperCase()}" is not in my dictionary.`);
        return;
      case 'already_guessed':
        {
          const game = svc.activeGame(chatId)!;
          const settings = svc.settings(chatId);
          await ctx.reply(alreadyGuessedText(out.word, game.answer, settings.emojiPack), { parse_mode: 'HTML' });
        }
        return;
      case 'creativity_blocked':
        await ctx.reply(`🚫 Creativity mode: ${out.word.toUpperCase()} was used recently here. Try something fresh!`);
        return;
      case 'hard_mode_violation':
        await ctx.reply(hardModeViolationText(out.violation, out.superHard, svc.settings(chatId).emojiPack), {
          parse_mode: 'HTML',
        });
        return;
      case 'not_your_turn':
        await ctx.reply(`⏳ Not so fast — it's ${out.currentPlayer.userName}'s turn.`);
        return;
    }

    const { game, guessNumber, solved, lost, tournament, duel } = out;
    const lines: string[] = [];

    if (lost) {
      if (duel) lines.push(`💀 Out of guesses! The word stays secret until your opponent finishes.`);
      else lines.push(`💀 Out of guesses! The word was ${game.answer.toUpperCase()}.`);
    }

    if (tournament) {
      const { t, pointsAwarded, roundEnded, tournamentEnded, nextGame, nextPlayer, winners } = tournament;
      if (solved) lines.push(`🎉 ${user.name} got it in ${guessNumber}/${MAX_GUESSES} +${pointsAwarded}`);
      const nextUpFooter = !roundEnded && nextPlayer ? `Next up ${playerMentionHtml(nextPlayer)}` : undefined;
      await sendBoard(ctx, chatId, game, lines.join('\n'), { footerHtml: nextUpFooter, hideKeyboard: solved });

      if (tournamentEnded) {
        const winnerNames = winners.map((w) => w.userName).join(' & ');
        await ctx.reply(
          `🏆 Tournament over!\n\n${standingsText(t)}\n\n👑 Winner${winners.length > 1 ? 's' : ''}: ${winnerNames}`
        );
      } else if (roundEnded && nextGame && nextPlayer) {
        await sendBoard(ctx, chatId, nextGame, '', { footerHtml: tournamentStatusHtml(t), hideKeyboard: true });
      }
      return;
    }

    if (solved) {
      lines.push(`🎉 ${user.name} got it in ${guessNumber}/${MAX_GUESSES}`);
    }

    if (duel) {
      await sendBoard(ctx, chatId, game, lines.join('\n'), { hideKeyboard: solved });
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

    await sendBoard(ctx, chatId, game, lines.join('\n'), { hideKeyboard: solved });
  }

  async function setDifficulty(ctx: Context, difficulty: 'normal' | 'hard' | 'superhard'): Promise<void> {
    const chatId = ctx.chat!.id;
    const s = svc.settings(chatId);
    s.difficulty = difficulty;
    svc.saveSettings(chatId, s);
    const labels = {
      normal: 'Normal',
      hard: '<tg-emoji emoji-id="5282832726385268445">🔠</tg-emoji> Hard',
      superhard: '<tg-emoji emoji-id="5282737683053980256">🔠</tg-emoji> Super-hard',
    };
    await ctx.reply(`Difficulty set to ${labels[difficulty]}`, { parse_mode: 'HTML' });
  }

  function creativityEnabledText(s: { creativity: { mode: 'time' | 'count'; seconds: number; count: number } }): string {
    const frame =
      s.creativity.mode === 'time' ? `last <b>${humanDuration(s.creativity.seconds)}</b>` : `last <b>${s.creativity.count} words</b>`;
    return `<tg-emoji emoji-id="5825794181183836432">✅</tg-emoji> Creativity mode enabled\nFrame: ${frame}`;
  }

  function tickText(text: string): string {
    return `<tg-emoji emoji-id="5825794181183836432">✅</tg-emoji> ${text}`;
  }

  function forbiddenText(text: string): string {
    return `<tg-emoji emoji-id="5872829476143894491">🚫</tg-emoji> ${text}`;
  }

  function playGuessInstruction(bareWord: boolean): string {
    return bareWord ? 'Send a word to guess' : 'Guess with /w [WORD]';
  }

  function autoGuessInstruction(bareWord: boolean): string {
    return bareWord ? 'Send a word to guess' : 'Use /w [WORD] to guess';
  }

  // ---------- commands ----------

  async function replyHelp(ctx: Context): Promise<void> {
    await ctx.reply(HELP_TEXT, { parse_mode: 'HTML', link_preview_options: { is_disabled: true } });
  }

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
    await replyHelp(ctx);
  });

  bot.command('help', (ctx) => replyHelp(ctx));

  bot.command('auto', async (ctx) => {
    const s = svc.settings(ctx.chat.id);
    s.bareWord = !s.bareWord;
    svc.saveSettings(ctx.chat.id, s);
    const text = `Guess without /w ${s.bareWord ? 'enabled' : 'disabled'}\n${autoGuessInstruction(s.bareWord)}`;
    await ctx.reply(s.bareWord ? tickText(text) : forbiddenText(text), { parse_mode: 'HTML' });
  });

  bot.command('usepack', async (ctx) => {
    const requestedName = (ctx.match ?? '').trim();
    if (!requestedName) {
      return void (await ctx.reply('Usage: /usepack name'));
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
        await ctx.reply(`${tickText('Custom emoji pack enabled')}\nPack: https://t.me/addemoji/${packName}`, {
          parse_mode: 'HTML',
        });
        return;
      } catch (error) {
        lastError = error;
      }
    }

    const message = lastError instanceof Error ? lastError.message : String(lastError);
    await ctx.reply(`Could not use emoji pack: ${message}`);
  });

  bot.command('play', async (ctx) => {
    const chatId = ctx.chat.id;
    const t = svc.openTournament(chatId);
    if (t) return void (await ctx.reply('A tournament is open in this chat — finish it or /tournament cancel first.'));
    const game = svc.startGame(chatId);
    if (!game) return void (await ctx.reply('A game is already running! Check /board or /giveup to abandon it.'));
    const s = svc.settings(chatId);
    await sendBoard(ctx, chatId, game, `${playGuessInstruction(s.bareWord)}`);
  });

  bot.command('w', async (ctx) => {
    const word = (ctx.match ?? '').trim();
    if (!/^[a-zA-Z]{5}$/.test(word)) {
      return void (await ctx.reply('Usage: /w WORD (a 5-letter word, e.g. /w crane)'));
    }
    await handleGuess(ctx, word);
  });

  bot.command('board', async (ctx) => {
    const chatId = ctx.chat.id;
    const game = svc.activeGame(chatId);
    const t = svc.openTournament(chatId);
    if (!game) {
      if (t && t.status === 'joining') return void (await ctx.reply(lobbyText(t), { parse_mode: 'HTML', reply_markup: lobbyKeyboard(t) }));
      return void (await ctx.reply('No active game. Send /play to start one!'));
    }
    if (t && t.status === 'active') {
      await sendBoard(ctx, chatId, game, '', { footerHtml: tournamentStatusHtml(t), hideKeyboard: true });
      return;
    }
    await sendBoard(ctx, chatId, game, '');
  });

  bot.command('giveup', async (ctx) => {
    const res = svc.giveUp(ctx.chat.id);
    if (!res) return void (await ctx.reply('No active game to give up.'));
    let msg = giveUpText(res.answer);
    await ctx.reply(msg, { parse_mode: 'HTML' });
  });

  bot.command('stats', async (ctx) => {
    const user = userRef(ctx);
    const row = svc.statsFor(ctx.chat.id, user.id);
    await ctx.reply(statsText(row, user.name));
  });

  bot.command('creativity', async (ctx) => {
    const chatId = ctx.chat.id;
    const arg = (ctx.match ?? '').trim();
    const s = svc.settings(chatId);

    if (!arg) {
      if (s.creativity.enabled) {
        s.creativity.enabled = false;
        svc.saveSettings(chatId, s);
        return void (
          await ctx.reply(forbiddenText('Creativity mode disabled'), {
            parse_mode: 'HTML',
          })
        );
      }

      if (!s.creativity.configured) {
        return void (await ctx.reply('Set a frame first: /creativity 30m or /creativity 15w'));
      }

      s.creativity.enabled = true;
      svc.saveSettings(chatId, s);
      return void (await ctx.reply(creativityEnabledText(s), { parse_mode: 'HTML' }));
    }

    const parsed = parseCreativityValue(arg);
    if (!parsed) {
      return void (await ctx.reply('Usage: /creativity 30m  |  /creativity 15w'));
    }

    s.creativity.enabled = true;
    s.creativity.configured = true;
    if ('seconds' in parsed) {
      s.creativity.mode = 'time';
      s.creativity.seconds = parsed.seconds;
    } else {
      s.creativity.mode = 'count';
      s.creativity.count = parsed.count;
    }
    svc.saveSettings(chatId, s);

    await ctx.reply(creativityEnabledText(s), { parse_mode: 'HTML' });
  });

  bot.command('normal', async (ctx) => setDifficulty(ctx, 'normal'));
  bot.command('hard', async (ctx) => setDifficulty(ctx, 'hard'));
  bot.command('superhard', async (ctx) => setDifficulty(ctx, 'superhard'));
  bot.command('mode_help', async (ctx) => ctx.reply(modeHelpText(svc.settings(ctx.chat.id)), { parse_mode: 'HTML' }));
  bot.command('creativity_help', async (ctx) =>
    ctx.reply(creativityHelpText(svc.settings(ctx.chat.id)), { parse_mode: 'HTML' })
  );

  bot.command('settings', async (ctx) => {
    const chatId = ctx.chat.id;
    const args = (ctx.match ?? '').trim();
    if (args) {
      return void (await ctx.reply('Usage: /settings'));
    }
    await ctx.reply(settingsText(svc.settings(chatId)), { parse_mode: 'HTML' });
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
        return void (await ctx.reply(lobbyText(existing), { parse_mode: 'HTML', reply_markup: lobbyKeyboard(existing) }));
      return void (await ctx.reply(`🏆 Tournament in progress — round ${existing.current_round}/${existing.rounds}.\nStandings:\n${standingsText(existing)}`));
    }
    const parsedRounds = parseInt(arg, 10);
    const rounds = Number.isFinite(parsedRounds) && parsedRounds >= 1 && parsedRounds <= 25 ? parsedRounds : 0;
    if (svc.activeGame(chatId)) return void (await ctx.reply('Finish the current game first (/giveup to abandon it).'));
    const t = svc.createTournament(chatId, rounds, userRef(ctx));
    if (!t) return void (await ctx.reply('Could not create a tournament right now.'));
    await ctx.reply(lobbyText(t), { parse_mode: 'HTML', reply_markup: lobbyKeyboard(t) });
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

  bot.callbackQuery(/^t:join:(\d+)$/, async (ctx) => {
    const res = svc.joinTournament(parseInt(ctx.match[1], 10), userRef(ctx));
    if (!res || res === 'closed') return void (await ctx.answerCallbackQuery('This tournament is not open for joining.'));
    if (res === 'already_in') return void (await ctx.answerCallbackQuery('You are already in!'));
    await ctx.editMessageText(lobbyText(res), { parse_mode: 'HTML', reply_markup: lobbyKeyboard(res) });
    await ctx.answerCallbackQuery('Joined! 🏆');
  });

  bot.callbackQuery(/^t:quit:(\d+)$/, async (ctx) => {
    const res = svc.quitTournament(parseInt(ctx.match[1], 10), ctx.from.id);
    if (!res || res === 'closed') return void (await ctx.answerCallbackQuery('This tournament is not open for joining.'));
    if (res === 'not_in') return void (await ctx.answerCallbackQuery('You are not in this tournament.'));
    await ctx.editMessageText(lobbyText(res), { parse_mode: 'HTML', reply_markup: lobbyKeyboard(res) });
    await ctx.answerCallbackQuery('Quit.');
  });

  bot.callbackQuery(/^t:start:(\d+)$/, async (ctx) => {
    const id = parseInt(ctx.match[1], 10);
    const t = svc.openTournament(ctx.chat!.id);
    if (!t || t.id !== id) return void (await ctx.answerCallbackQuery('This tournament is no longer open.'));
    if (t.created_by !== ctx.from.id) return void (await ctx.answerCallbackQuery('Only the creator can start it.'));
    const res = svc.startTournament(id);
    if (res === 'too_few') return void (await ctx.answerCallbackQuery('Need at least 1 player!'));
    if (!res) return void (await ctx.answerCallbackQuery('Could not start the tournament.'));
    await ctx.answerCallbackQuery('Game on!');
    await ctx.editMessageText(lobbyText(res.t), { parse_mode: 'HTML', reply_markup: { inline_keyboard: [] } });
    await sendBoard(ctx, ctx.chat!.id, res.game, '', { footerHtml: tournamentStatusHtml(res.t), hideKeyboard: true });
  });

  // ---------- bare-word guessing ----------

  bot.on('message:text', async (ctx) => {
    const text = ctx.message.text.trim();
    if (text.startsWith('/')) return;
    if (!/^[a-zA-Z]{5}$/.test(text)) return;
    if (!svc.settings(ctx.chat.id).bareWord) return;
    await handleGuess(ctx, text, { silentNoGame: true });
  });
}
