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

const kbps = (n?: number) => (n ? (n >= 1000 ? ` · ${(n / 1000).toFixed(1)} Мбит/с` : ` · ${n} кбит/с`) : '');
const fmt = (a: Track) => `${a.codec ?? '?'}${a.channels ? ` ${a.channels}ch` : ''}${a.atmos ? ' Atmos' : ''}${kbps(a.bitrateKbps)}`;
/** Не автор: служебные слова и метки источника («Original», «Dub», «ATMOS)»). */
const NOT_AUTHOR = /^(original|оригинал|dub|дубляж|mvo|dvo|avo|vo|atmos|rus|eng|commentary)$/i;
/** Тип перевода в начале подписи («DVO. П.Гланц», «AVO, Н.Антонов», «Дубляж: R5») — не часть имени автора. */
const TYPE_PREFIX = /^(dub|mvo|dvo|avo|vo|дубляж|многоголосый|двухголосый|одноголосый|авторский|закадровый)(?![a-zа-яё])[\s.,:;|-]*/i;
const cleanAuthor = (s?: string) => {
  let t = (s ?? '').replace(/[()]/g, '').trim();
  for (let i = 0; i < 3 && TYPE_PREFIX.test(t); i++) t = t.replace(TYPE_PREFIX, '').trim();
  t = t.replace(/^[.,:;|-]+|[.,:;|-]+$/g, '').trim();
  return t && !NOT_AUTHOR.test(t) ? t : undefined;
};
/** Ключ автора: без инициалов и регистра («Ю. Сербин» = «Сербин», «В. Королёв» = «Королёв»). */
const authorKey = (s?: string) => norm((cleanAuthor(s) ?? '').replace(/(^|\s)[A-ZА-ЯЁ]\.\s*/g, ' ').replace(/ё/g, 'е'));
const who = (a: Track) => {
  const l = LANG[a.lang] ?? a.lang.toUpperCase();
  const k = KIND[a.kind] ?? a.kind;
  const au = cleanAuthor(a.author);
  return au ? `${l} ${k} ${au}` : `${l} ${k}`;
};
/** Тот же формат: кодек совпадает; каналы и lossless сравниваем, только если известны с обеих сторон. */
const sameFormat = (x: Track, y: Track) => norm(x.codec) === norm(y.codec) && (!x.channels || !y.channels || x.channels === y.channels) && !!x.atmos === !!y.atmos
  && (!x.bitrateKbps || !y.bitrateKbps || Math.abs(x.bitrateKbps - y.bitrateKbps) / Math.max(x.bitrateKbps, y.bitrateKbps) <= 0.15);   // битрейт: отличие > 15% — изменение
export const trackLabel = (a: Track) => `${who(a)} — ${fmt(a)}`;

/** Сопоставление дорожек: язык + тип + автор; без автора — по порядку внутри «язык + тип». */
function keyed(list: Track[]) {
  const seen = new Map<string, number>();
  return list.map(a => {
    const base = `${a.lang}|${a.kind}|${authorKey(a.author)}`;
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
  // 1) точный ключ (язык + тип + автор без инициалов); 2) тот же язык и тип, одно имя продолжает другое («HDRezka» = «HDRezka Studio»)
  const pairs: [Track, Track][] = [];
  const restA = [...a], restB = [...b];
  for (let i = restA.length - 1; i >= 0; i--) {
    const j = restB.findIndex(x => x.key === restA[i].key);
    if (j >= 0) { pairs.push([restA[i].a, restB[j].a]); restA.splice(i, 1); restB.splice(j, 1); }
  }
  // 3) одноголосый: AVO и VO — одно и то же («AVO. Н.Антонов» = «VO Н.Антонов»); 4) у одной стороны автор не указан — тот же формат
  const kindFamily = (k: string) => (k === 'avo' || k === 'vo' ? 'one' : k);
  const sameExact = (x: Track, y: Track) => sameFormat(x, y) && (!x.bitrateKbps || !y.bitrateKbps || Math.abs(x.bitrateKbps - y.bitrateKbps) / Math.max(x.bitrateKbps, y.bitrateKbps) <= 0.03);
  const passes: ((x: Track, y: Track) => boolean)[] = [
    (x, y) => y.lang === x.lang && y.kind === x.kind && !!authorKey(x.author) && !!authorKey(y.author)
      && (authorKey(y.author).startsWith(authorKey(x.author)) || authorKey(x.author).startsWith(authorKey(y.author))),
    (x, y) => y.lang === x.lang && kindFamily(y.kind) === kindFamily(x.kind) && !!authorKey(x.author) && authorKey(x.author) === authorKey(y.author),
    (x, y) => y.lang === x.lang && kindFamily(y.kind) === kindFamily(x.kind) && (!authorKey(x.author) || !authorKey(y.author)) && sameExact(x, y),
  ];
  for (const pass of passes) for (let i = restA.length - 1; i >= 0; i--) {
    const x = restA[i].a;
    const j = restB.findIndex(y => pass(x, y.a));
    if (j >= 0) { pairs.push([x, restB[j].a]); restA.splice(i, 1); restB.splice(j, 1); }
  }
  for (let i = restA.length - 1; i >= 0; i--) {
    const x = restA[i].a, kx = authorKey(x.author);
    const j = restB.findIndex(y => y.a.lang === x.lang && y.a.kind === x.kind && kx && authorKey(y.a.author) && (authorKey(y.a.author).startsWith(kx) || kx.startsWith(authorKey(y.a.author))));
    if (j >= 0) { pairs.push([x, restB[j].a]); restA.splice(i, 1); restB.splice(j, 1); }
  }
  const order = (t: Track) => cur.audio.indexOf(t);
  pairs.sort((p, q) => order(p[0]) - order(q[0]));
  const same: string[] = [], changed: string[] = [];
  for (const [t, n] of pairs) (sameFormat(t, n) ? same.push(trackLabel(t)) : changed.push(`${who(t)}: ${fmt(t)} → ${fmt(n)}`));
  const removed = restA.reverse().map(x => trackLabel(x.a));
  const added = restB.map(x => trackLabel(x.a));

  const rs = (s: ReleaseSpec) => s.subs.filter(x => x.lang === 'rus').length;
  const subs = cur.subs.length !== cand.subs.length || rs(cur) !== rs(cand)
    ? `${cur.subs.length} → ${cand.subs.length} (рус: ${rs(cur)} → ${rs(cand)})` : undefined;
  return { video, audio: { before: cur.audio.length, after: cand.audio.length, same, changed, added, removed }, subs };
}

/** Строки для Telegram (без HTML — экранирует и оформляет вызывающий): заголовок группы, затем по строке на дорожку. */
export interface Line { text: string; head?: boolean; }
export function changesLines(c: Changes, compact = false): Line[] {
  const out: Line[] = [];
  out.push({ text: 'Видео', head: true });
  for (const v of c.video) out.push({ text: `• ${v}` });
  const au = c.audio;
  out.push({ text: `Аудио: ${au.before} → ${au.after} дорожек`, head: true });
  const group = (title: string, xs: string[], collapse = false) => {
    if (!xs.length) return;
    out.push({ text: `${title} (${xs.length})${collapse ? '' : ':'}` });
    if (!collapse) for (const x of xs) out.push({ text: `   • ${x}` });
  };
  group('≠ Изменились', au.changed);
  group('+ Добавились', au.added);
  group('− Пропали', au.removed);
  group('= Без изменений', au.same, compact);
  if (c.subs) { out.push({ text: 'Субтитры', head: true }); out.push({ text: `• ${c.subs}` }); }
  return out;
}
