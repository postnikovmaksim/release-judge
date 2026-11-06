import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { classifyAudio, extractAuthor, normLang, normalizeHomoglyphs } from './classify.js';
import type { ReleaseSpec } from './schema.js';

const run = promisify(execFile);
type T = Record<string, string | undefined>;

export async function mediainfo(path: string): Promise<T[]> {
  const { stdout } = await run('mediainfo', ['--Output=JSON', path], { maxBuffer: 64 << 20 });
  return JSON.parse(stdout).media?.track ?? [];
}

const num = (v?: string) => (v && !isNaN(+v) ? +v : undefined);

export function specFromMediainfo(tracks: T[], originalLang?: string): ReleaseSpec {
  const g = tracks.find(t => t['@type'] === 'General') ?? {};
  const v = tracks.find(t => t['@type'] === 'Video') ?? {};
  const hdrFmt = `${v.HDR_Format ?? ''} ${v.HDR_Format_Compatibility ?? ''} ${v.Format_Commercial_IfAny ?? ''}`;
  const hdr: ReleaseSpec['video']['hdr'] = [];
  if (/dolby vision/i.test(hdrFmt)) hdr.push('dv');
  if (/HDR10\+|SMPTE ST 2094/i.test(hdrFmt)) hdr.push('hdr10plus');
  if (/HDR10|SMPTE ST 2086/i.test(hdrFmt)) hdr.push('hdr10');
  if (/HLG/i.test(hdrFmt)) hdr.push('hlg');
  if (!hdr.length && /PQ|SMPTE ST 2084/i.test(v.transfer_characteristics ?? '')) hdr.push('hdr10');
  if (!hdr.length && /HLG|ARIB STD-B67/i.test(v.transfer_characteristics ?? '')) hdr.push('hlg');
  const dvProf = (v.HDR_Format_Profile ?? '').match(/\.(0?\d)\./)?.[1];
  const orig = originalLang ? normLang(originalLang) : undefined;

  const audio = tracks.filter(t => t['@type'] === 'Audio').map(a => {
    let lang = normLang(a.Language);
    if (lang === "und") {   // язык не указан, но дорожка названа «Русский» / «RUS» / «English»
      const m = (a.Title ?? "").match(/^\s*\|?\s*(rus|russian|русский|eng|english|английский|ukr|ukrainian|украинский)(?![a-zа-яё])/i);
      if (m) lang = normLang(m[1]);
    }
    a = { ...a, Title: normalizeHomoglyphs(a.Title) };
    const commercial = `${a.Format_Commercial_IfAny ?? ''} ${a.Format ?? ''} ${a.Format_AdditionalFeatures ?? ''}`;
    return {
      lang,
      kind: classifyAudio(a.Title, lang, orig),
      author: extractAuthor(a.Title),
      codec: /TrueHD|MLP/i.test(commercial) ? 'TrueHD' : /XLL|DTS-HD Master/i.test(commercial) ? 'DTS-HD MA'
        : /E-AC-3/i.test(commercial) ? 'EAC3' : /AC-3/i.test(commercial) ? 'AC3' : /DTS/i.test(commercial) ? 'DTS'
        : /FLAC/i.test(commercial) ? 'FLAC' : /PCM/i.test(commercial) ? 'PCM' : a.Format,
      lossless: a.Compression_Mode === 'Lossless' || /TrueHD|MLP|XLL|DTS-HD Master|FLAC|PCM/i.test(commercial),   // Compression mode бывает не указан
      atmos: /atmos|16-ch/i.test(commercial),
      channels: num(a.Channels),
      bitrateKbps: parseBitrateKbps(a.BitRate),
      title: a.Title,
    };
  });

  const subs = tracks.filter(t => t['@type'] === 'Text').map(s => ({
    lang: normLang(s.Language),
    kind: (s.Forced === 'Yes' || /forced|форсир|надпис/i.test(s.Title ?? '') ? 'forced'
      : /comment|коммент/i.test(s.Title ?? '') ? 'commentary' : /sdh/i.test(s.Title ?? '') ? 'sdh' : 'full') as any,
    format: s.Format === 'UTF-8' ? 'SRT' : s.Format,
  }));

  return {
    video: {
      width: num(v.Width), height: num(v.Height), codec: v.Format, hdr,
      dvProfile: dvProf ? +dvProf : undefined,
      dvLayer: /BL\+EL/i.test(v.HDR_Format_Settings ?? '') ? undefined : undefined, // FEL/MEL mediainfo не различает
      bitrateKbps: parseBitrateKbps(v.BitRate),
      localized: false, upscale: false,
      source: g.Title,
    },
    audio, subs,
    sizeBytes: num(g.FileSize),
    durationSec: parseDuration(g.Duration ?? v.Duration),
    uniqueId: g.UniqueID ? String(g.UniqueID).split(/\s/)[0] : undefined,
    confidence: 1,
  };
}
/** Дополнить тип/автора дорожек подсказками из описания (если в MediaInfo названия неинформативны). */
export function enrichAudio(spec: ReleaseSpec, hints: Map<number, string>) {
  spec.audio.forEach((a, i) => {
    const h = hints.get(i + 1);
    if (!h) return;
    const kind = classifyAudio(h, a.lang);
    if (a.kind === 'unknown' || (kind !== 'unknown' && kind !== a.kind && a.kind !== 'commentary')) a.kind = kind;
    if (!a.author && ['dub', 'mvo', 'dvo', 'avo', 'vo'].includes(a.kind)) a.author = extractAuthor(h);
    if (!a.title || a.title.length < 5) a.title = h;
  });
}

const LANG_WORD = /^(русский|russian|английский|english|украинский|ukrainian|японский|japanese|казахский|kazakh|французский|french|немецкий|german)/i;
function codecFromText(s: string) {
  return /truehd/i.test(s) ? 'TrueHD' : /DTS[- ]?(HD|X)\s*MA|DTS-X/i.test(s) ? 'DTS-HD MA' : /E-?AC-?3|DD\+/i.test(s) ? 'EAC3'
    : /\bAC-?3\b|\bDD\b/i.test(s) ? 'AC3' : /\bDTS\b/i.test(s) ? 'DTS' : /FLAC/i.test(s) ? 'FLAC' : /Opus/i.test(s) ? 'Opus' : /AAC/i.test(s) ? 'AAC' : undefined;
}

/**
 * Если в дампе у дорожек нет языка (или дорожек меньше, чем в сводке) — достраиваем из строк «Аудио N: Русский … - Дубляж».
 */
export function fillFromSummary(spec: ReleaseSpec, summary: Map<number, { line: string; hint?: string }>) {
  for (const [n, { line, hint }] of summary) {
    const lw = line.replace(/^[\s|:]+/, '').match(LANG_WORD)?.[1];
    const lang = lw ? normLang(lw) : undefined;
    const kind = hint ? classifyAudio(hint, lang ?? 'und') : 'unknown';
    const tr = spec.audio[n - 1];
    if (tr) {
      if (tr.lang === 'und' && lang) tr.lang = lang;
      if (tr.kind === 'unknown' && kind !== 'unknown') tr.kind = kind;
    } else if (lang) {
      const codec = codecFromText(line);
      spec.audio.push({ lang, kind: kind === 'unknown' && /оригинал|original/i.test(hint ?? '') ? 'original' : kind,
        codec, lossless: /TrueHD|DTS-HD MA|FLAC|PCM/.test(codec ?? ''), atmos: /atmos/i.test(line),
        channels: Number(line.match(/(\d)\s*ch\b|(\d)\.\d/i)?.slice(1).find(Boolean)) || undefined,
        bitrateKbps: parseBitrateKbps(line),
        author: ['dub', 'mvo', 'dvo', 'avo', 'vo'].includes(kind) ? extractAuthor(hint) : undefined, title: hint });
    }
  }
}

/** Название раздачи заявляет дубляж, а по дорожкам его не видно (подписаны только студией) — первая русская «unknown» = дубляж. */
export function applyTitleDub(spec: ReleaseSpec, claims: boolean) {
  if (!claims || spec.audio.some(a => a.lang === 'rus' && a.kind === 'dub')) return;
  const t = spec.audio.find(a => a.lang === 'rus' && a.kind === 'unknown');
  if (t) { t.kind = 'dub'; t.author = t.author ?? extractAuthor(t.title?.replace(/[|]/g, '')); }
}

/** «6796.792» (JSON, сек) | «01:53:16.792» | «1 h 53 min» | «1 ч. 53 мин.» → секунды. */
export function parseDuration(v?: string | number): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const s = String(v).trim();
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(+s);
  const hms = s.match(/^(\d{1,2}):(\d{2}):(\d{2})(?:[.,]\d+)?/);
  if (hms) return +hms[1] * 3600 + +hms[2] * 60 + +hms[3];
  const h = s.match(/(\d+)\s*(?:h|ч)/i)?.[1], m = s.match(/(\d+)\s*(?:min|mn|мин|м(?![а-яё]))/i)?.[1], sec = s.match(/(\d+)\s*(?:s|с)(?![a-zа-яё])/i)?.[1];
  if (!h && !m) return undefined;
  return +(h ?? 0) * 3600 + +(m ?? 0) * 60 + +(sec ?? 0);
}

/** Битрейт → кбит/с: «640000» (JSON, бит/с) | «448 kb/s» | «4 194 kb/s» | «47.8 Mb/s» | «640 Кбит/сек» | «4194 Kbps/1509 Kbps» (берём первое). */
export function parseBitrateKbps(v?: string | number): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const s = String(v).trim();
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(+s / 1000);
  const m = s.replace(/(\d)[\s\u00a0\u202f](?=\d{3}\b)/g, '$1').match(/(\d+(?:[.,]\d+)?)\s*(kb\/?s|kbps|кбит|kbit|mb\/?s|mbps|мбит|mbit)/i);
  if (!m) return undefined;
  const n = parseFloat(m[1].replace(',', '.'));
  return Math.round(/^m|^м/i.test(m[2]) ? n * 1000 : n);
}
