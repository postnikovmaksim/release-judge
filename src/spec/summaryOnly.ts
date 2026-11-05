import type { ReleaseSpec } from './schema.js';
import { fillFromSummary } from './fromMediainfo.js';
import { audioSummary } from './descFlags.js';

/** Раздача без MediaInfo/BDInfo: видео — из названия и строки «Видео:», дорожки — из «Аудио N:». Низкая уверенность. */
export function specFromSummary(title: string, description: string): ReleaseSpec | undefined {
  const sum = audioSummary(description);
  if (!sum.size) return undefined;
  const videoLine = description.split('\n').find(l => /^\s*(Видео|Video)\s*:/i.test(l)) ?? '';
  const t = `${title} ${videoLine}`;
  const hdr: ReleaseSpec['video']['hdr'] = [];
  if (/dolby\s*vision|\bDV\b/i.test(t)) hdr.push('dv');
  if (/HDR10\+|HDR10plus/i.test(t)) hdr.push('hdr10plus');
  if (/HDR10(?!\+)|\bHDR\b/i.test(t)) hdr.push('hdr10');
  const h = /2160p|\b4K\b|3840x/i.test(t) ? 2160 : /1080p|1920x/i.test(t) ? 1080 : undefined;
  const spec: ReleaseSpec = {
    video: { hdr, height: h, width: h === 2160 ? 3840 : h === 1080 ? 1920 : undefined,
      dvProfile: hdr.includes('dv') ? dvProfileFromText(`${t}\n${description}`) : undefined,
      localized: false, upscale: false },
    audio: [], subs: /Субтитры:.*(рус|russian)/i.test(description) ? [{ lang: 'rus', kind: 'full' }] : [],
    confidence: 0.5,
  };
  fillFromSummary(spec, sum);
  return spec.audio.length ? spec : undefined;
}

/** DV-профиль только по явным маркерам (не «5 x ЛО», не «5.1»). Kinozal «Dolby Vision TV» = однослойный P8. Неизвестно → undefined. */
export function dvProfileFromText(t: string): number | undefined {
  const m = t.match(/dvhe\.0?([4-9])/i) ?? t.match(/(?:dolby\s*vision|\bDV)[^\n]{0,25}?profile\s*([4-9])\b/i)
    ?? t.match(/profile\s*([4-9])\b/i) ?? t.match(/\bDV\s*P([4-9])\b|\bP([578])\s*(?:FEL|MEL)\b/i);
  if (m) return Number(m[1] ?? m[2]);
  if (/dolby\s*vision\s*TV/i.test(t)) return 8;
  return undefined;
}

/**
 * Kinozal: «Аудио: Русский (AC3, 6 ch, 448 Кбит/с), (DTS-HD MA, 8 ch, …), английский (TrueHD+Atmos, …)» на странице
 * + ненумерованные «Аудио: … • Профессиональный многоголосый» во вкладке → нумерованные «Аудио N: язык, кодек - подпись».
 */
export function kinozalAudioLines(pageText: string, tabText: string): string {
  const line = pageText.split('\n').find(l => /^\s*Аудио\s*:/i.test(l));
  if (!line) return '';
  const tracks: string[] = []; let lang = '';
  for (const m of line.replace(/^\s*Аудио\s*:/i, '').matchAll(/([А-Яа-яЁёA-Za-z]+)?\s*\(([^)]*)\)/g)) {
    if (m[1]) lang = m[1];
    tracks.push(`${lang}, ${m[2]}`);
  }
  const hints = tabText.split('\n').filter(l => /^\s*Аудио\s*:/i.test(l)).map(l => l.split('•').pop()!.trim());
  return tracks.map((t, i) => `Аудио ${i + 1}: ${t}${hints[i] ? ' - ' + hints[i] : ''}`).join('\n');
}
