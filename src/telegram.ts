import { config } from './config.js';
import { db, kvGet, kvSet, addIgnore } from './db.js';
import type { JudgeResult } from './judge/service.js';
import { changesLines, sizeLine } from './judge/changes.js';

const enabled = () => Boolean(config.telegram.token && config.telegram.chatId);
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export async function tg(method: string, body: any = {}): Promise<any> {
  const r = await fetch(`https://api.telegram.org/bot${config.telegram.token}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const j: any = await r.json();
  if (!j.ok) throw new Error(`telegram ${method}: ${j.description}`);
  return j.result;
}

const ICON: Record<string, string> = { UPGRADE: '🔼', REVIEW: '🤔', KEEP: '⏸', REJECT: '⛔' };

/** Карточка по фильму: текущий файл + кандидаты UPGRADE/REVIEW с причинами и кнопками. */
export async function sendMovieCard(movieId: number, title: string, currentLine: string, items: JudgeResult[], currentUrl?: string) {
  if (!enabled() || !items.length) return;
  const cur = currentUrl ? `<a href="${esc(currentUrl)}">${esc(currentLine)}</a>` : esc(currentLine);
  const build = (compact: boolean) => {
  const lines = [`🎬 <b>${esc(title)}</b>`, `Сейчас: ${cur}`, ''];
  items.forEach((it, i) => {
    lines.push(`${ICON[it.verdict]} <b>#${i + 1} ${it.verdict}</b> — <a href="${esc(it.topicUrl)}">${esc(it.candidateTitle.slice(0, 120))}</a>`);
    const block = (label: string, xs?: string[]) => { if (xs?.length) lines.push(`   <b>${label}:</b> ${esc(xs.join("; "))}`); };
    block("Почему", it.why); block("Минусы", it.cons); block("Проверить", it.check);
    if (!it.why?.length && !it.cons?.length && !it.check?.length) it.reasons.forEach(r => lines.push(`   • ${esc(r)}`));
    const sz = sizeLine(it.currentSize, it.candidateSize);
    if (sz) lines.push(`   <b>Размер:</b> ${esc(sz)}`);
    if (it.verdict === 'REVIEW' && it.changes) {                       // на ревью — картина целиком
      // свёрнутая цитата: видно начало, остальное раскрывается нажатием (Bot API 7.4+)
      const body = changesLines(it.changes, compact).map(l => (l.head ? `<b>${esc(l.text)}</b>` : esc(l.text))).join('\n');
      lines.push(`<b>Картина целиком</b>\n<blockquote expandable>${body}</blockquote>`);
    }
    lines.push('');
  });
  return lines;
  };
  let lines = build(false);
  if (lines.join('\n').length > 4000) lines = build(true);           // лимит Telegram 4096 — неизменные дорожки свернуть до счётчика
  const mode = kvGet('actions_mode') ?? 'report';
  if (mode === 'report') lines.push('<i>Режим отчёта: «Заменить» пока только записывает решение.</i>');
  const keyboard = items.map((it, i) => [
    { text: `✅ Заменить #${i + 1}`, callback_data: `v:${it.id}:ok` },
    { text: `🚫 Игнор #${i + 1}`, callback_data: `v:${it.id}:ig` },
  ]);
  keyboard.push([{ text: '⏸ Оставить как есть', callback_data: `m:${movieId}:keep` }]);
  const msg = await tg('sendMessage', { chat_id: config.telegram.chatId, text: lines.join('\n').slice(0, 4000),
    parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: { inline_keyboard: keyboard } });
  db.prepare('INSERT OR REPLACE INTO tg_message (message_id, movie_id, verdict_ids) VALUES (?, ?, ?)')
    .run(msg.message_id, movieId, JSON.stringify(items.map(i => i.id)));
}

export async function sendText(text: string) {
  if (!enabled()) return;
  await tg('sendMessage', { chat_id: config.telegram.chatId, text, parse_mode: 'HTML', disable_web_page_preview: true });
}

// ---------- приём нажатий (long polling вместо webhook — публичный URL не нужен) ----------
async function handleCallback(q: any, log: (m: string) => void) {
  const [kind, id, action] = String(q.data ?? '').split(':');
  const msg = q.message;
  let note = '';
  if (kind === 'v') {
    const v = db.prepare('SELECT * FROM verdict WHERE id = ?').get(Number(id)) as any;
    if (!v) { await tg('answerCallbackQuery', { callback_query_id: q.id, text: 'Вердикт не найден' }); return; }
    if (action === 'ig') {
      addIgnore(v.topic_url, v.movie_id, v.release_title, 'telegram');
      if (v.guid) addIgnore(v.guid, v.movie_id, v.release_title, 'telegram');
      db.prepare("UPDATE verdict SET user_decision = 'ignore' WHERE id = ?").run(v.id);
      note = `🚫 Игнор: ${v.release_title?.slice(0, 60)}`;
    } else if (action === 'ok') {
      db.prepare("UPDATE verdict SET user_decision = 'approve' WHERE id = ?").run(v.id);
      note = `✅ Одобрено к замене: ${v.release_title?.slice(0, 60)}`;
    }
  } else if (kind === 'm' && action === 'keep') {
    const row = db.prepare('SELECT verdict_ids FROM tg_message WHERE message_id = ?').get(msg?.message_id) as any;
    const ids: number[] = row ? JSON.parse(row.verdict_ids) : [];
    for (const vid of ids) {
      const v = db.prepare('SELECT * FROM verdict WHERE id = ? AND user_decision IS NULL').get(vid) as any;
      if (!v) continue;
      addIgnore(v.topic_url, v.movie_id, v.release_title, 'telegram-keep');
      db.prepare("UPDATE verdict SET user_decision = 'keep' WHERE id = ?").run(vid);
    }
    note = '⏸ Оставлено как есть, кандидаты в игноре';
  }
  await tg('answerCallbackQuery', { callback_query_id: q.id, text: note.slice(0, 190) || 'ок' });
  if (msg && note) {
    // дописываем решение в текст карточки; кнопки убираем, если решено всё
    const text = `${msg.text ?? ''}\n\n${note}`.slice(0, 4000);
    const keyboard = kind === 'm' ? [] : (msg.reply_markup?.inline_keyboard ?? []).filter((row: any[]) =>
      !row.some(b => b.callback_data?.startsWith(`v:${id}:`)));
    await tg('editMessageText', { chat_id: msg.chat.id, message_id: msg.message_id, text, disable_web_page_preview: true,
      entities: msg.entities, reply_markup: { inline_keyboard: keyboard.length > 1 ? keyboard : [] } }).catch(e => log(String(e)));
  }
  log(`telegram callback ${q.data} -> ${note}`);
}

export async function startPolling(log: (m: string) => void) {
  if (!enabled()) { log('telegram: disabled (no token/chat id)'); return; }
  await tg('deleteWebhook', { drop_pending_updates: false });     // long polling несовместим с webhook
  log('telegram: polling started');
  let offset = Number(kvGet('tg_offset') ?? 0);
  for (;;) {
    try {
      const updates: any[] = await tg('getUpdates', { offset, timeout: 50, allowed_updates: ['callback_query', 'message'] });
      for (const u of updates) {
        offset = u.update_id + 1; kvSet('tg_offset', String(offset));
        if (u.callback_query && String(u.callback_query.message?.chat?.id) === String(config.telegram.chatId))
          await handleCallback(u.callback_query, log).catch(e => log(`callback error: ${e.message}`));
      }
    } catch (e: any) {
      log(`telegram poll error: ${e.message}`);
      await new Promise(r => setTimeout(r, 10_000));
    }
  }
}
