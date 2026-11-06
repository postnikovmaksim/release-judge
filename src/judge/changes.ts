/**
 * «Картина целиком» для карточки REVIEW: что меняется в видео, аудио и субтитрах между текущим файлом и раздачей.
 * Чистая функция — покрыта тестами (changes.test.ts).
 */
import type { ReleaseSpec } from '../spec/schema.js';
import { videoLabel } from './compare.js';

type Track = ReleaseSpec['audio'][number];
const KIND: Record<string, string> = { dub: 'Дубляж', mvo: 'MVO', dvo: 'DVO', avo: 'Авторский', vo: 'VO', original: 'Оригинал', commentary: 'Комментарии', unknown: '?' };
const LANG: Record<string, string> = { rus: 'RUS', eng: 'ENG', ukr: 'UKR', jpn: 'JPN', und: '?' };
const norm = (s?: string) => (s ?? '').toLowerCase().replace(/[^a-zа-яё0-9]/g, '');

const fmt = (a: Track) => `${a.codec ?? '?'} ${a.channels ?? '?'}ch${a.atmos ? ' Atmos' : ''}`;
const who = (a: Track) => {
  const l = LANG[a.lang] ?? a.lang.toUpperCase();
  const k = KIND[a.kind] ?? a.kind;
  return a.author ? `${l} ${k} ${a.author}` : `${l} ${k}`;
};
export const trackLabel = (a: Track) => `${who(a)} — ${fmt(a)}`;

/** Сопоставление дорожек: язык + тип + автор; без автора — по порядку внутри «язык + тип». */
function keyed(list: Track[]) {
  const seen = new Map<string, number>();
  return list.map(a => {
    const base = `${a.lang}|${a.kind}|${norm(a.author)}`;
    const i = seen.get(base) ?? 0; seen.set(base, i + 1);
    return { key: `${base}#${i}`, a };
  });
}

export interface Changes {
  size?: string;
  video: string[];
  audio: { before: number; after: number; same: string[]; changed: string[]; added: string[]; removed: string[] };
  subs?: string;
}

export const fmtGB = (b?: number) => (b ? `${(b / 1024 ** 3).toFixed(1)} ГБ` : '?');
export function sizeLine(cur?: number, cand?: number): string | undefined {
  if (!cur && !cand) return undefined;
  const d = cur && cand ? cand - cur : undefined;
  return `${fmtGB(cur)} → ${fmtGB(cand)}${d !== undefined ? ` (${d >= 0 ? '+' : '−'}${(Math.abs(d) / 1024 ** 3).toFixed(1)} ГБ)` : ''}`;
}

export function describeChanges(cur: ReleaseSpec, cand: ReleaseSpec): Changes {
  const video: string[] = [];
  const vc = cur.video, vn = cand.video;
  const lc = videoLabel(cur), ln = videoLabel(cand);
  if (lc !== ln) video.push(`HDR: ${lc} → ${ln}`);
  if (vc.codec && vn.codec && norm(vc.codec) !== norm(vn.codec)) video.push(`кодек: ${vc.codec} → ${vn.codec}`);
  if (vc.bitrateKbps && vn.bitrateKbps) {
    const p = Math.round((vn.bitrateKbps / vc.bitrateKbps - 1) * 100);
    video.push(`битрейт: ${(vc.bitrateKbps / 1000).toFixed(1)} → ${(vn.bitrateKbps / 1000).toFixed(1)} Мбит/с${p ? ` (${p > 0 ? '+' : ''}${p}%)` : ''}`);
  }
  if (vn.localized) video.push('локализованный видеоряд');
  if (vn.upscale) video.push('апскейл');
  if (!video.length) video.push(`без изменений (${lc})`);

  const a = keyed(cur.audio), b = keyed(cand.audio);
  const bm = new Map(b.map(x => [x.key, x.a]));
  const am = new Set(a.map(x => x.key));
  const same: string[] = [], changed: string[] = [], removed: string[] = [];
  for (const { key, a: t } of a) {
    const n = bm.get(key);
    if (!n) removed.push(trackLabel(t));
    else if (fmt(t) === fmt(n) && !!t.lossless === !!n.lossless) same.push(trackLabel(t));
    else changed.push(`${who(t)}: ${fmt(t)} → ${fmt(n)}`);
  }
  const added = b.filter(x => !am.has(x.key)).map(x => trackLabel(x.a));

  const rs = (s: ReleaseSpec) => s.subs.filter(x => x.lang === 'rus').length;
  const subs = cur.subs.length !== cand.subs.length || rs(cur) !== rs(cand)
    ? `${cur.subs.length} → ${cand.subs.length} (рус: ${rs(cur)} → ${rs(cand)})` : undefined;
  return { video, audio: { before: cur.audio.length, after: cand.audio.length, same, changed, added, removed }, subs };
}

/** Строки для Telegram (без HTML-экранирования — это делает вызывающий). compact — только счётчик неизменных дорожек. */
export function changesLines(c: Changes, compact = false): string[] {
  const out: string[] = [];
  out.push(`Видео: ${c.video.join('; ')}`);
  const au = c.audio;
  out.push(`Аудио: было ${au.before} дорожек, станет ${au.after}`);
  if (au.same.length) out.push(compact ? `  = без изменений: ${au.same.length}` : `  = без изменений (${au.same.length}): ${au.same.join('; ')}`);
  if (au.changed.length) out.push(`  ≠ изменились: ${au.changed.join('; ')}`);
  if (au.added.length) out.push(`  + добавились: ${au.added.join('; ')}`);
  if (au.removed.length) out.push(`  − пропали: ${au.removed.join('; ')}`);
  if (c.subs) out.push(`Субтитры: ${c.subs}`);
  return out;
}
