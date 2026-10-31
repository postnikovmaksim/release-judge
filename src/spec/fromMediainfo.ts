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
    const lang = normLang(a.Language);
    a = { ...a, Title: normalizeHomoglyphs(a.Title) };
    const commercial = `${a.Format_Commercial_IfAny ?? ''} ${a.Format ?? ''} ${a.Format_AdditionalFeatures ?? ''}`;
    return {
      lang,
      kind: classifyAudio(a.Title, lang, orig),
      author: extractAuthor(a.Title),
      codec: /TrueHD|MLP/i.test(commercial) ? 'TrueHD' : /XLL|DTS-HD Master/i.test(commercial) ? 'DTS-HD MA'
        : /E-AC-3/i.test(commercial) ? 'EAC3' : /AC-3/i.test(commercial) ? 'AC3' : /DTS/i.test(commercial) ? 'DTS'
        : /FLAC/i.test(commercial) ? 'FLAC' : /PCM/i.test(commercial) ? 'PCM' : a.Format,
      lossless: a.Compression_Mode === 'Lossless',
      atmos: /atmos|16-ch/i.test(commercial),
      channels: num(a.Channels),
      bitrateKbps: num(a.BitRate) ? Math.round(+a.BitRate! / 1000) : undefined,
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
      bitrateKbps: num(v.BitRate) ? Math.round(+v.BitRate! / 1000) : undefined,
      localized: false, upscale: false,
      source: g.Title,
    },
    audio, subs,
    sizeBytes: num(g.FileSize),
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
