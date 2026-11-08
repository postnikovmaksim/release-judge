import type { ReleaseSpec } from '../spec/schema.js';

export type Verdict = 'UPGRADE' | 'KEEP' | 'REVIEW' | 'REJECT';
export interface Dim { dim: string; current: string; candidate: string; cmp: -1 | 0 | 1; }   // cmp: 1 = кандидат лучше
export interface Judgement { verdict: Verdict; reasons: string[]; dims: Dim[]; why?: string[]; cons?: string[]; check?: string[]; }

export interface Rules {
  trackers?: { priority?: string[] };
  hard_reject?: { dv_profile_5?: boolean; upscale?: boolean; lose_russian_dub?: boolean };
  flags_to_review?: { localized_video?: boolean; lose_cult_translation?: boolean };
  compare_order?: string[];
  cult_translations?: { name: string; match: string; only_if_year_before?: number }[];
}
export interface Ctx {
  year?: number; originalLang?: string;          // ISO-639-2 языка оригинала фильма (из Radarr)
  currentTracker?: string; candidateTracker?: string;
  currentEditionText?: string; candidateEditionText?: string;   // откуда угадывать редакцию
  candidateTitle?: string;                        // название раздачи (RUS(ext), заявленный дубляж)
}

const cmp = (a: number, b: number): -1 | 0 | 1 => (b > a ? 1 : b < a ? -1 : 0);

// ---------- видео: HDR10+ (универсальный формат) > DV > HDR10 > HLG > SDR; внутри DV градации (P7 FEL/MEL, P8) не важны ----------
export function videoRank(s: ReleaseSpec): number {
  const v = s.video;
  if (v.hdr.includes('dv') && v.dvProfile === 5 && !v.hdr.includes('hdr10')) return 0.5;   // P5 без фоллбэка — особый случай, кандидата с этим отбрасывает hard_reject
  if (v.hdr.includes('hdr10plus')) return 4;      // шире поддержка, чем у DV — топ независимо от того, есть DV вместе с ним или нет
  if (v.hdr.includes('dv')) return 3;             // любой профиль/слой — не различаем (P7 FEL = P7 MEL = P8)
  if (v.hdr.includes('hdr10')) return 2;
  if (v.hdr.includes('hlg')) return 1;
  return 0;
}
export const videoLabel = (s: ReleaseSpec) => {
  const v = s.video, parts: string[] = [];
  if (v.hdr.includes('dv')) parts.push(`DV${v.dvProfile ? ' P' + v.dvProfile : ''}${v.dvLayer ? ' ' + v.dvLayer : ''}`);
  if (v.hdr.includes('hdr10plus')) parts.push('HDR10+');
  if (v.hdr.includes('hdr10')) parts.push('HDR10');
  if (v.hdr.includes('hlg')) parts.push('HLG');
  return `${v.height ?? '?'}p ${parts.join(' + ') || 'SDR'}`;
};

// ---------- редакция: длиннее = лучше ----------
const LONG_EDITION = /extended|расширенн|director'?s|режисс[её]рск|uncut|unrated|ultimate|полная верси|без цензуры/i;
/** Разница длительности, начиная с которой это другая редакция (MediaInfo в тексте округляет до минуты). */
export const EDITION_SAME_SEC = 180;

/** Падение видеобитрейта от этой доли — повод для REVIEW, даже если по другим пунктам кандидат лучше (не блокирует UPGRADE сам по себе — только когда есть что терять). */
export const VIDEO_BITRATE_DROP_FRAC = 0.05;
const fmtDur = (s: number) => `${Math.floor(s / 3600)}:${String(Math.floor(s % 3600 / 60)).padStart(2, '0')}`;
export const editionRank = (t?: string) => (t && LONG_EDITION.test(t) ? 1 : 0);
const editionLabel = (t?: string) => t?.match(LONG_EDITION)?.[0] ?? 'обычная';

// ---------- дубляж ----------
const codecRank = (a: { codec?: string; lossless?: boolean }) =>
  a.lossless || /TrueHD|DTS-HD\s*MA|FLAC|PCM|LPCM/i.test(a.codec ?? '') ? 3 : /DTS|EAC3|E-AC-3|DD\+/i.test(a.codec ?? '') ? 2 : /AC3|AAC|Opus/i.test(a.codec ?? '') ? 1 : 0;
type DubState = 'none' | 'unknown' | 'lossy' | 'lossless';
interface DubInfo { score?: number; state: DubState; label: string; authors: string[]; offRank?: number; offLabel?: string; bestCustom?: boolean; bestPatched?: boolean; }
/** Дубляж со вставками: расширенные/недублированные сцены закрыты закадром («+ MVO», «вставки», «на Extended Edition»). */
export const PATCHED = /встав|insert|\+\s*(mvo|dvo|avo|vo|закадр|многогол|двухгол|одногол)|на\s+(extended|расширенн|режисс)/i;
const normAuthor = (a: string) => a.toLowerCase().replace(/[^a-zа-яё0-9]/g, '');
/** Метки источника, а не студии: официальная дорожка с диска/стриминга одинакова во всех раздачах. */
export const OFFICIAL = /licen[cs]e|лицензи|uhd-?bd|blu-?ray|\bbd\b|\bdvd\b|\br5\b|itunes|netflix|amazon|disney|apple\s*tv|okko|кинопоиск|\bivi\b|\bcee\b|\beur\b|\busa\b/i;
/** Любительская сборка (не официальная): Custom, RUSATMOS, апмикс... — хорошая, но решать вручную. */
export const CUSTOM = /custom|кастом|любительск|сборк|up-?mix|апмикс|rusatmos/i;
const tx = (a: { title?: string; author?: string }) => `${a.title ?? ''} ${a.author ?? ''}`;
const isCustom = (a: { title?: string; author?: string }) => CUSTOM.test(tx(a));
const isOfficial = (a: { title?: string; author?: string }) => OFFICIAL.test(tx(a)) && !isCustom(a);
/** Не авторы: метки источника, сборки, техника. */
const NOT_AUTHOR = new RegExp(`${OFFICIAL.source}|${CUSTOM.source}|atmos|\\brus\\b|\\bdub\\b`, 'i');
const realAuthor = (a?: string) => (a && !NOT_AUTHOR.test(a) && normAuthor(a).length > 2 ? normAuthor(a) : undefined);
function dubInfo(s: ReleaseSpec, opts: { claims?: boolean; ext?: boolean; otherOfficialNonDub?: boolean } = {}): DubInfo {
  const rus = s.audio.filter(a => a.lang === 'rus');
  // официальная дорожка у второй стороны подписана не как дубляж -> здешний «Dub, Licence» — та же дорожка, тип подписи не доверяем
  const dubs = rus.filter(a => a.kind === 'dub' && !(opts.otherOfficialNonDub && isOfficial(a) && !realAuthor(a.author)));
  if (dubs.length) {
    const ll = dubs.filter(a => a.lossless);
    // лучший дубляж: lossless > lossy, затем каналы, затем Atmos (Хоббит: DTS-HD MA 8ch by sergey_n лучше TrueHD 6ch)
    const best = [...dubs].sort((x, y) => dubScore(y) - dubScore(x))[0];
    const lbl = (a: typeof best) => `${a.codec ?? '?'}${a.channels ? ` ${a.channels}ch` : ''}${a.author ? ' (' + a.author + ')' : ''}`;
    const off = dubs.filter(isOfficial).sort((x, y) => codecRank(y) - codecRank(x))[0];
    return { state: ll.length ? 'lossless' : 'lossy', label: lbl(best), score: dubScore(best),
      authors: dubs.map(a => realAuthor(a.author)).filter((x): x is string => Boolean(x)),
      offRank: off ? codecRank(off) : undefined, offLabel: off ? lbl(off) : undefined, bestCustom: isCustom(best), bestPatched: PATCHED.test(tx(best)) };
  }
  if (opts.ext) return { state: 'unknown', label: 'внешняя дорожка (RUS ext)', authors: [] };
  if (opts.claims || rus.some(a => a.kind === 'unknown')) return { state: 'unknown', label: 'не распознан', authors: [] };
  return { state: 'none', label: 'нет', authors: [] };
}
const dubRankOf = (s: DubState) => (s === 'lossless' ? 2 : s === 'lossy' ? 1 : 0);
/** Качество дорожки дубляжа: класс (lossless/lossy) важнее всего, затем каналы, затем битрейт (целыми Мбит/с — шум < 1 Мбит/с не считаем), затем Atmos. Цель — 7.1 Atmos на 4-8 Мбит/с. */
function dubScore(a: { lossless?: boolean; codec?: string; channels?: number; atmos?: boolean; bitrateKbps?: number }) {
  return codecRank(a) * 100 + (a.channels ?? 0) * 2 + Math.floor((a.bitrateKbps ?? 0) / 1000) + (a.atmos ? 1 : 0);
}

// ---------- оригинал: тай-брейк, бонус, если дубляж/MVO/культовые ничего не решили ----------
function bestOriginal(s: ReleaseSpec, origLang?: string) {
  // не для всех фильмов оригинал английский: дорожка «неизвестного» типа — оригинал, только если её язык совпадает с origLang
  // (иначе немецкая/французская дорожка на японском фильме ложно конкурировала бы за «лучший оригинал»)
  const o = origLang === 'rus'
    ? s.audio.filter(a => a.lang === 'rus')                                     // русский фильм: оригинал — русская дорожка
    : s.audio.filter(a => a.kind === 'original' || (a.lang !== 'rus' && a.lang !== 'ukr' && a.kind === 'unknown' && (!origLang || a.lang === origLang)));
  if (!o.length) return { r: 0, label: 'нет' };
  const score = (a: any) => codecRank(a) + (a.atmos ? 1 : 0);
  const b = o.reduce((x, y) => (score(y) > score(x) ? y : x));
  return { r: score(b), label: `${b.codec ?? '?'}${b.atmos ? ' Atmos' : ''}${b.channels ? ` ${b.channels}ch` : ''}` };
}
const rusSubs = (s: ReleaseSpec) => (s.subs.some(x => x.lang === 'rus' && x.kind === 'full') ? 1 : 0);
function trackerRank(t: string | undefined, prio: string[]) {
  const i = t ? prio.findIndex(p => p.toLowerCase() === t.toLowerCase()) : -1;
  return i < 0 ? 0 : prio.length - i;
}
const hasCult = (s: ReleaseSpec, re: RegExp) => s.audio.some(a => a.lang === 'rus' && re.test(`${a.title ?? ''} ${a.author ?? ''}`));

// ---------- главное ----------
export function judge(current: ReleaseSpec, cand: ReleaseSpec, rules: Rules, ctx: Ctx = {}): Judgement {
  const hr = rules.hard_reject ?? {}, fr = rules.flags_to_review ?? {};
  const ruOriginal = ctx.originalLang === 'rus';
  const title = ctx.candidateTitle ?? '';
  const candExt = /RUS\s*\(ext\)|внешн\w* (дорожк|звук)/i.test(title) && !cand.audio.some(a => a.lang === 'rus');
  const candClaims = /\bDub\b|дубляж|дублир|[|,]\s*D\s*(?:[,|]|$)/i.test(title);
  const offNonDub = (x: ReleaseSpec) => x.audio.some(a => a.lang === 'rus' && a.kind !== 'dub' && isOfficial(a));
  // «Dub» у официальной дорожки не доверяем, только если это похоже на ту же дорожку с другой подписью (Индиана):
  // у второй стороны официальная не-дубляж дорожка и нет своего дубляжа, а у этой стороны своей официальной не-дубляж дорожки нет.
  // Лебовски: в файле «Дубляж, DVD Group» и отдельно MVO «BD-CEE» — это две разные дорожки, дубляж настоящий.
  const hasDub = (x: ReleaseSpec) => x.audio.some(a => a.lang === 'rus' && a.kind === 'dub');
  const distrust = (self: ReleaseSpec, other: ReleaseSpec) => offNonDub(other) && !hasDub(other) && !offNonDub(self);
  const cur = dubInfo(current, { otherOfficialNonDub: distrust(current, cand) });
  const cnd = dubInfo(cand, { claims: candClaims, ext: candExt, otherOfficialNonDub: distrust(cand, current) });
  // Редакция: если длительность известна у обоих — решает она (надпись «Ultimate»/«Extended» бывает у той же версии), иначе — текст.
  const byDur = current.durationSec && cand.durationSec ? cand.durationSec - current.durationSec : undefined;
  const edCmp = byDur !== undefined ? (byDur >= EDITION_SAME_SEC ? 1 : byDur <= -EDITION_SAME_SEC ? -1 : 0)
    : cmp(editionRank(ctx.currentEditionText), editionRank(ctx.candidateEditionText));
  const edLabel = (t: string | undefined, d?: number) => editionLabel(t) + (d ? ` · ${fmtDur(d)}` : '');
  const prio = rules.trackers?.priority ?? ['TeamHD', 'Tapochek'];
  const orig = { c: bestOriginal(current, ctx.originalLang), n: bestOriginal(cand, ctx.originalLang) };

  const all: Record<string, Dim> = {
    edition: { dim: 'редакция', current: edLabel(ctx.currentEditionText, current.durationSec), candidate: edLabel(ctx.candidateEditionText, cand.durationSec), cmp: edCmp },
    video: { dim: 'видео', current: videoLabel(current), candidate: videoLabel(cand), cmp: cmp(videoRank(current), videoRank(cand)) },
    russian_dub: ruOriginal ? { dim: 'русский дубляж', current: '—', candidate: '—', cmp: 0 }
      : { dim: 'русский дубляж', current: cur.label, candidate: cnd.label,
          cmp: cur.state === 'unknown' || cnd.state === 'unknown' ? 0
            : cur.score !== undefined && cnd.score !== undefined ? cmp(cur.score, cnd.score) : cmp(dubRankOf(cur.state), dubRankOf(cnd.state)) },
    original_audio: { dim: ruOriginal ? 'оригинал (рус.)' : 'оригинал', current: orig.c.label, candidate: orig.n.label, cmp: cmp(orig.c.r, orig.n.r) },
    subtitles: { dim: 'рус. субтитры', current: rusSubs(current) ? 'есть' : 'нет', candidate: rusSubs(cand) ? 'есть' : 'нет', cmp: cmp(rusSubs(current), rusSubs(cand)) },
    tracker: { dim: 'трекер', current: ctx.currentTracker ?? '?', candidate: ctx.candidateTracker ?? cand.tracker ?? '?', cmp: cmp(trackerRank(ctx.currentTracker, prio), trackerRank(ctx.candidateTracker ?? cand.tracker, prio)) },
  };
  const order = ['edition', ...(rules.compare_order ?? ['video', 'russian_dub', 'original_audio', 'subtitles', 'tracker']).filter(k => k !== 'edition')];
  const dims = order.filter(k => all[k]).map(k => all[k]);

  // 1) тот же релиз
  if (current.uniqueId && current.uniqueId === cand.uniqueId) return { verdict: 'KEEP', reasons: ['это тот же релиз, что уже лежит в библиотеке'], dims };

  // 2) жёсткие отказы
  const reject: string[] = [];
  if (hr.dv_profile_5 !== false && cand.video.hdr.includes('dv') && cand.video.dvProfile === 5 && !cand.video.hdr.includes('hdr10'))
    reject.push('DV Profile 5 без HDR10-фоллбэка (не будет direct play)');
  if (hr.upscale !== false && cand.video.upscale) reject.push('апскейл');
  if (cand.container === 'bdmv') reject.push('структура диска BDMV/m2ts, не mkv — как BR-DISK');
  if (edCmp < 0) reject.push(`младшая редакция (${all.edition.current} → ${all.edition.candidate})`);
  if (!ruOriginal && hr.lose_russian_dub !== false && (cur.state === 'lossy' || cur.state === 'lossless') && cnd.state === 'none')
    reject.push('нет русского дубляжа, а в текущем файле он есть');
  if (reject.length) return { verdict: 'REJECT', reasons: reject, dims };
  if (!cand.audio.some(a => a.lang !== 'und') && !candExt) return { verdict: 'KEEP', reasons: ['не удалось определить аудиодорожки раздачи'], dims };

  const is4k = (s: ReleaseSpec) => (s.video.width ?? 0) >= 3200 || (s.video.height ?? 0) >= 2000;
  if (is4k(current) !== is4k(cand)) return { verdict: 'KEEP', reasons: ['другой уровень качества (1080p vs 2160p) — решает Radarr'], dims };

  // 3) флаги на ручную проверку
  const flags: string[] = [];
  if (fr.localized_video !== false && cand.video.localized) flags.push('локализованный видеоряд');
  if (candExt) flags.push('русская дорожка внешняя (не внутри mkv)');
  if ((cand.confidence ?? 1) < 1) flags.push('разобрано по краткому описанию раздачи (MediaInfo нет) — проверь вручную');
  const vb = current.video.bitrateKbps, nb = cand.video.bitrateKbps;
  if (vb && nb && nb < vb * (1 - VIDEO_BITRATE_DROP_FRAC))
    flags.push(`видео битрейт ниже (${(vb / 1000).toFixed(1)} → ${(nb / 1000).toFixed(1)} Мбит/с, ${Math.round((nb / vb - 1) * 100)}%)`);
  if (!ruOriginal && cur.state === 'lossless' && cnd.state === 'lossy') flags.push(`дубляж lossless → lossy (${cur.label} → ${cnd.label})`);
  if (!ruOriginal && all.russian_dub.cmp > 0 && cnd.bestCustom) flags.push(`дубляж лучше за счёт любительской сборки (${cnd.label})`);
  if (!ruOriginal && all.russian_dub.cmp > 0 && cnd.bestPatched) flags.push(`дубляж со вставками закадрового перевода (${cnd.label})`);
  if (!ruOriginal && cur.offRank !== undefined && cnd.offRank !== undefined && cnd.offRank < cur.offRank)
    flags.push(`официальный дубляж хуже (${cur.offLabel} → ${cnd.offLabel})`);
  if (!ruOriginal && cur.authors.length && cnd.authors.length) {
    const cAuth = cnd.authors;
    const same = cur.authors.some(a => cAuth.some(b => a.includes(b) || b.includes(a)));
    if (!same) flags.push(`другая студия дубляжа (${cur.label} → ${cnd.label})`);
  }
  if (fr.lose_cult_translation !== false)
    for (const c of rules.cult_translations ?? []) {
      if (c.only_if_year_before && ctx.year && ctx.year >= c.only_if_year_before) continue;
      const re = new RegExp(c.match.replace(/^\(\?i\)/, ''), 'i');
      if (hasCult(current, re) && !hasCult(cand, re)) flags.push(`пропадает перевод: ${c.name}`);
    }

  // 4) решение
  const fmt = (d: Dim) => `${d.dim}: ${d.current} → ${d.candidate}`;
  const wins = dims.filter(d => d.cmp > 0 && d !== all.tracker).map(fmt);
  const cons = dims.filter(d => d.cmp < 0 && d !== all.tracker).map(fmt);
  const check = flags.filter(f => !/более длинная редакция/.test(f));
  const out = (verdict: Verdict, reasons: string[]): Judgement => ({ verdict, reasons, dims, why: wins, cons, check });
  if (edCmp > 0) return out('REVIEW', [...flags, ...wins.map(w => 'лучше — ' + w), ...cons.map(c => 'хуже — ' + c)]);
  const first = dims.find(d => d.cmp !== 0);
  if (!first) return out('KEEP', ['равноценно']);                                   // флаги без выигрыша не повод
  if (first.cmp < 0) return out('KEEP', [`хуже: ${first.dim} (${first.candidate} < ${first.current})`]);
  if (first === all.tracker) {                                                        // выигрыш только трекером
    return check.length ? out('KEEP', ['лучше только трекер, но есть что проверить: ' + check.join('; ')]) : out('UPGRADE', ['лучше: трекер (' + fmt(first) + ')']);
  }
  const win = `лучше: ${fmt(first)}`;
  if (check.length || cons.length) return out('REVIEW', [win, ...check, ...cons.map(c => 'потеря — ' + c)]);
  return out('UPGRADE', [win]);
}
