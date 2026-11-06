/** Текст карточки фильма для Telegram — чистые функции (тесты: card.test.ts). */
import type { JudgeResult } from './judge/service.js';
import { changesLines, sizeLine } from './judge/changes.js';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const ICON: Record<string, string> = { UPGRADE: '🔼', REVIEW: '🤔', KEEP: '⏸', REJECT: '⛔' };

/** Текст карточки (HTML). bodyLimit — сколько строк «картины целиком» оставить (для влезания в лимит). */
export function renderCard(title: string, cur: string, items: JudgeResult[], startIndex = 0, compact = false, bodyLimit = Infinity): string {
  const lines = [`🎬 <b>${esc(title)}</b>`, `Сейчас: ${cur}`, ''];
  items.forEach((it, k) => {
    const i = startIndex + k;
    lines.push(`${ICON[it.verdict]} <b>#${i + 1} ${it.verdict}</b> — <a href="${esc(it.topicUrl)}">${esc(it.candidateTitle.slice(0, 120))}</a>`);
    const block = (label: string, xs?: string[]) => {                  // по пункту на строку
      if (!xs?.length) return;
      lines.push(`   <b>${label}:</b>`);
      for (const x of xs) lines.push(`   • ${esc(x)}`);
    };
    block('Почему', it.why); block('Минусы', it.cons); block('Проверить', it.check);
    if (!it.why?.length && !it.cons?.length && !it.check?.length) it.reasons.forEach(r => lines.push(`   • ${esc(r)}`));
    const sz = sizeLine(it.currentSize, it.candidateSize);
    if (sz) lines.push(`   <b>Размер:</b> ${esc(sz)}`);
    if (it.mirrors?.length)
      lines.push(`   <b>Та же раздача ещё на:</b> ${it.mirrors.map(m => `<a href="${esc(m.topicUrl)}">${esc(m.tracker ?? 'трекер')}</a>`).join(', ')}`);
    if (it.changes) {                                                   // картина целиком (и для UPGRADE, и для REVIEW) в свёрнутой цитате
      let cl = changesLines(it.changes, compact);
      if (cl.length > bodyLimit) cl = [...cl.slice(0, bodyLimit), { text: `… ещё ${cl.length - bodyLimit} строк — см. раздачу` }];
      const body = cl.map(l => (l.head ? `<b>${esc(l.text)}</b>` : esc(l.text))).join('\n');
      lines.push(`<b>Картина целиком</b>\n<blockquote expandable>${body}</blockquote>`);
    }
    lines.push('');
  });
  return lines.join('\n');
}

const LIMIT = 4000;   // Telegram: 4096 символов на сообщение
/** Вписать карточку в лимит: полная → свёрнутые «без изменений» → урезанная сводка. Резать HTML посередине нельзя (Telegram отклонит). */
export function fitCard(title: string, cur: string, items: JudgeResult[], startIndex = 0): string | undefined {
  for (const compact of [false, true]) { const t = renderCard(title, cur, items, startIndex, compact); if (t.length <= LIMIT) return t; }
  for (let n = 40; n >= 4; n -= 4) { const t = renderCard(title, cur, items, startIndex, true, n); if (t.length <= LIMIT) return t; }
  return undefined;
}


/**
 * Одинаковые раздачи на разных трекерах (размер совпадает с точностью 0,1%) — предлагаем одну:
 * лучший вердикт (UPGRADE раньше REVIEW), затем подробный разбор (MediaInfo, а не краткое описание), затем трекер по лесенке.
 */
export function groupSame(items: JudgeResult[], priority: string[] = ['TeamHD', 'Tapochek']): JudgeResult[] {
  const rank = (t?: string) => { const i = t ? priority.findIndex(p => p.toLowerCase() === t.toLowerCase()) : -1; return i < 0 ? priority.length : i; };
  const better = (a: JudgeResult, b: JudgeResult) =>
    (a.verdict === b.verdict ? 0 : a.verdict === 'UPGRADE' ? -1 : 1) || ((b.confidence ?? 1) - (a.confidence ?? 1)) || (rank(a.tracker) - rank(b.tracker));
  const groups: JudgeResult[][] = [];
  for (const it of items) {
    const g = it.candidateSize ? groups.find(g => g[0].candidateSize && Math.abs(g[0].candidateSize - it.candidateSize!) / Math.max(g[0].candidateSize, it.candidateSize!) <= 0.001) : undefined;
    if (g) g.push(it); else groups.push([it]);
  }
  return groups.map(g => {
    const [best, ...rest] = [...g].sort(better);
    return rest.length ? { ...best, mirrors: rest.map(r => ({ tracker: r.tracker, topicUrl: r.topicUrl })) } : best;
  }).sort((a, b) => (a.verdict === b.verdict ? 0 : a.verdict === 'UPGRADE' ? -1 : 1));
}
