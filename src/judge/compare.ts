import type { ReleaseSpec } from '../spec/schema.js';

export type Verdict = 'UPGRADE' | 'KEEP' | 'REVIEW' | 'REJECT';
export interface Dim { dim: string; current: string; candidate: string; cmp: -1 | 0 | 1; }   // cmp: 1 = кандидат лучше
export interface Judgement { verdict: Verdict; reasons: string[]; dims: Dim[]; }

export interface Rules {
  trackers?: { priority?: string[] };
  hard_reject?: { dv_profile_5?: boolean; upscale?: boolean; lose_russian_dub?: boolean };
  flags_to_review?: { localized_video?: boolean; lose_cult_translation?: boolean };
  compare_order?: string[];
  cult_translations?: { name: string; match: string; only_if_year_before?: number }[];
}
export interface Ctx { year?: number; currentTracker?: string; candidateTracker?: string; }

// ---------- оценки по измерениям ----------
export function videoRank(s: ReleaseSpec): number {
  const v = s.video, dv = v.hdr.includes('dv');
  let r = 0;
  if (dv) {
    if (v.dvProfile === 5) r = 0.5;                                  // P5 без фоллбэка — хуже SDR для direct play
    else if (v.dvProfile === 7) r = v.dvLayer === 'FEL' ? 6 : v.dvLayer === 'MEL' ? 5 : 5.5;   // P7: FEL > MEL; слой неизвестен — см. videoCmp
    else r = 4;                                                       // P8 и прочие
    if (v.hdr.includes('hdr10plus')) r += 0.5;
  } else if (v.hdr.includes('hdr10plus')) r = 3;
  else if (v.hdr.includes('hdr10')) r = 2;
  else if (v.hdr.includes('hlg')) r = 1;
  return r;
}
const videoLabel = (s: ReleaseSpec) => {
  const v = s.video, parts: string[] = [];
  if (v.hdr.includes('dv')) parts.push(`DV${v.dvProfile ? ' P' + v.dvProfile : ''}${v.dvLayer ? ' ' + v.dvLayer : ''}`);
  if (v.hdr.includes('hdr10plus')) parts.push('HDR10+');
  if (v.hdr.includes('hdr10')) parts.push('HDR10');
  if (v.hdr.includes('hlg')) parts.push('HLG');
  return `${v.height ?? '?'}p ${parts.join(' + ') || 'SDR'}`;
};

const codecRank = (a: { codec?: string; lossless?: boolean }) =>
  a.lossless ? 3 : /DTS|EAC3|E-AC-3|DD\+/i.test(a.codec ?? '') ? 2 : /AC3|AAC|Opus/i.test(a.codec ?? '') ? 1 : 0;

function bestDub(s: ReleaseSpec) {
  const dubs = s.audio.filter(a => a.lang === 'rus' && a.kind === 'dub');
  if (!dubs.length) return { r: 0, label: 'нет' };
  const b = dubs.reduce((x, y) => (codecRank(y) > codecRank(x) ? y : x));
  return { r: dubRank(b), label: `${b.codec ?? '?'} ${b.channels ?? '?'}ch${b.author ? ' (' + b.author + ')' : ''}` };
}
function bestOriginal(s: ReleaseSpec) {
  const o = s.audio.filter(a => a.kind === 'original' || (a.lang !== 'rus' && a.lang !== 'ukr' && a.kind === 'unknown'));
  if (!o.length) return { r: 0, label: 'нет' };
  const score = (a: any) => codecRank(a) + (a.atmos ? 1 : 0);
  const b = o.reduce((x, y) => (score(y) > score(x) ? y : x));
  return { r: score(b), label: `${b.codec ?? '?'}${b.atmos ? ' Atmos' : ''} ${b.channels ?? '?'}ch` };
}
const rusSubs = (s: ReleaseSpec) => (s.subs.some(x => x.lang === 'rus' && x.kind === 'full') ? 1 : 0);
function trackerRank(t: string | undefined, prio: string[]) {
  const i = t ? prio.findIndex(p => p.toLowerCase() === t.toLowerCase()) : -1;
  return i < 0 ? 0 : prio.length - i;
}
const cmp = (a: number, b: number): -1 | 0 | 1 => (b > a ? 1 : b < a ? -1 : 0);

function hasCult(s: ReleaseSpec, re: RegExp) {
  return s.audio.some(a => a.lang === 'rus' && re.test(`${a.title ?? ''} ${a.author ?? ''}`));
}

// ---------- главное ----------
export function judge(current: ReleaseSpec, cand: ReleaseSpec, rules: Rules, ctx: Ctx = {}): Judgement {
  const reasons: string[] = [];
  const hr = rules.hard_reject ?? {}, fr = rules.flags_to_review ?? {};

  // 1) жёсткие отказы
  if (hr.dv_profile_5 !== false && cand.video.hdr.includes('dv') && cand.video.dvProfile === 5 && !cand.video.hdr.includes('hdr10'))
    reasons.push('DV Profile 5 без HDR10-фоллбэка (не будет direct play)');
  if (hr.upscale !== false && cand.video.upscale) reasons.push('апскейл');
  const curDub = bestDub(current), candDub = bestDub(cand);
  const candKnown = cand.audio.some(a => a.lang !== 'und');
  if (hr.lose_russian_dub !== false && curDub.r > 0 && candDub.r === 0 && candKnown) reasons.push('нет русского дубляжа, а в текущем файле он есть');

  // 2) измерения
  const prio = rules.trackers?.priority ?? ['TeamHD', 'Tapochek'];
  const all: Record<string, Dim> = {
    video: { dim: 'видео', current: videoLabel(current), candidate: videoLabel(cand), cmp: videoCmp(current, cand) },
    russian_dub: { dim: 'русский дубляж', current: curDub.label, candidate: candDub.label, cmp: cmp(curDub.r, candDub.r) },
    original_audio: { dim: 'оригинал', current: bestOriginal(current).label, candidate: bestOriginal(cand).label, cmp: cmp(bestOriginal(current).r, bestOriginal(cand).r) },
    subtitles: { dim: 'рус. субтитры', current: rusSubs(current) ? 'есть' : 'нет', candidate: rusSubs(cand) ? 'есть' : 'нет', cmp: cmp(rusSubs(current), rusSubs(cand)) },
    tracker: { dim: 'трекер', current: ctx.currentTracker ?? '?', candidate: ctx.candidateTracker ?? cand.tracker ?? '?', cmp: cmp(trackerRank(ctx.currentTracker, prio), trackerRank(ctx.candidateTracker ?? cand.tracker, prio)) },
  };
  const order = rules.compare_order ?? ['video', 'russian_dub', 'original_audio', 'subtitles', 'tracker'];
  const dims = order.filter(k => all[k]).map(k => all[k]);

  if (current.uniqueId && current.uniqueId === cand.uniqueId) return { verdict: 'KEEP', reasons: ['это тот же релиз, что уже лежит в библиотеке'], dims };
  if (reasons.length) return { verdict: 'REJECT', reasons, dims };
  if (!candKnown) return { verdict: 'KEEP', reasons: ['не удалось определить аудиодорожки раздачи'], dims };

  // разрешение должно совпадать — иначе это грубый шаг (дело Radarr)
  const is4k = (s: ReleaseSpec) => (s.video.width ?? 0) >= 3200 || (s.video.height ?? 0) >= 2000;
  if (is4k(current) !== is4k(cand))
    return { verdict: 'KEEP', reasons: ['другой уровень качества (1080p vs 2160p) — решает Radarr'], dims };

  // 3) флаги на ручную проверку
  const flags: string[] = [];
  if (fr.localized_video !== false && cand.video.localized) flags.push('локализованный видеоряд');
  if (fr.lose_cult_translation !== false)
    for (const c of rules.cult_translations ?? []) {
      if (c.only_if_year_before && ctx.year && ctx.year >= c.only_if_year_before) continue;
      const re = new RegExp(c.match.replace(/^\(\?i\)/, ''), 'i');
      if (hasCult(current, re) && !hasCult(cand, re)) flags.push(`пропадает перевод: ${c.name}`);
    }

  // 4) первое отличие решает; «строго лучше» = выигрыш без проигрышей ниже
  const first = dims.find(d => d.cmp !== 0);
  if (!first) return { verdict: flags.length ? 'REVIEW' : 'KEEP', reasons: flags.length ? flags : ['равноценно'], dims };
  if (first.cmp < 0) return { verdict: 'KEEP', reasons: [`хуже: ${first.dim} (${first.candidate} < ${first.current})`], dims };
  // трекер — только тай-брейк: его «потеря» не делает апгрейд компромиссом
  const losses = dims.filter(d => d.cmp < 0 && d !== all.tracker).map(d => `${d.dim}: ${d.current} → ${d.candidate}`);
  const win = `лучше: ${first.dim} (${first.current} → ${first.candidate})`;
  if (flags.length || losses.length)
    return { verdict: 'REVIEW', reasons: [win, ...flags, ...losses.map(l => 'потеря — ' + l)], dims };
  return { verdict: 'UPGRADE', reasons: [win], dims };
}

/** Сравнение видео: если у обоих P7 и хотя бы у одного слой неизвестен — слой не сравниваем. */
export function videoCmp(a: ReleaseSpec, b: ReleaseSpec): -1 | 0 | 1 {
  const p7 = (s: ReleaseSpec) => s.video.hdr.includes('dv') && s.video.dvProfile === 7;
  if (p7(a) && p7(b) && (!a.video.dvLayer || !b.video.dvLayer)) {
    const plus = (s: ReleaseSpec) => (s.video.hdr.includes('hdr10plus') ? 1 : 0);
    return cmp(plus(a), plus(b));
  }
  return cmp(videoRank(a), videoRank(b));
}
const dubRank = (a: { codec?: string; lossless?: boolean }) => (a.lossless ? 2 : 1);   // для дубляжа важно только наличие и lossless
