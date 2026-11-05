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
      dvProfile: hdr.includes('dv') ? (/\bP?8\b|profile\s*8/i.test(t) ? 8 : /\bP?5\b|profile\s*5/i.test(t) ? 5 : 7) : undefined,
      localized: false, upscale: false },
    audio: [], subs: /Субтитры:.*(рус|russian)/i.test(description) ? [{ lang: 'rus', kind: 'full' }] : [],
    confidence: 0.5,
  };
  fillFromSummary(spec, sum);
  return spec.audio.length ? spec : undefined;
}
