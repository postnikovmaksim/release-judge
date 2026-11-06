import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeChanges, changesLines, sizeLine } from './changes.js';
import type { ReleaseSpec } from '../spec/schema.js';

const T = (lang: string, kind: string, codec: string, channels: number, author?: string, x: any = {}) => ({ lang, kind, codec, channels, author, ...x });
const S = (video: any, audio: any[], subs: any[] = []): ReleaseSpec => ({ video: { localized: false, upscale: false, height: 2160, width: 3840, ...video }, audio, subs, confidence: 1 } as any);

test('[11-06] F1: карточка REVIEW — видео (HDR, битрейт), аудио (осталось/изменилось/добавилось/пропало), субтитры', () => {
  const cur = S({ hdr: ['dv', 'hdr10'], dvProfile: 8, codec: 'HEVC', bitrateKbps: 62000 }, [
    T('rus', 'dub', 'EAC3', 6, 'Netflix'), T('rus', 'mvo', 'AC3', 6, 'HDRezka'), T('rus', 'avo', 'AC3', 2, 'Яроцкий'),
    T('eng', 'original', 'TrueHD', 8, undefined, { atmos: true, lossless: true }),
  ], [{ lang: 'rus', kind: 'full' }, { lang: 'eng', kind: 'full' }]);
  const cand = S({ hdr: ['dv', 'hdr10plus', 'hdr10'], dvProfile: 7, dvLayer: 'MEL', codec: 'HEVC', bitrateKbps: 78000 }, [
    T('rus', 'dub', 'TrueHD', 8, 'Netflix', { atmos: true, lossless: true }), T('rus', 'mvo', 'AC3', 6, 'HDRezka'),
    T('rus', 'vo', 'AC3', 2, 'Кубик в Кубе'), T('eng', 'original', 'TrueHD', 8, undefined, { atmos: true, lossless: true }),
  ], [{ lang: 'rus', kind: 'full' }, { lang: 'rus', kind: 'forced' }, { lang: 'eng', kind: 'full' }]);
  const c = describeChanges(cur, cand);
  assert.ok(c.video.some(v => /HDR: 2160p DV P8 \+ HDR10 → 2160p DV P7 MEL \+ HDR10\+ \+ HDR10/.test(v)));
  assert.ok(c.video.some(v => /битрейт: 62\.0 → 78\.0 Мбит\/с \(\+26%\)/.test(v)));
  assert.equal(c.audio.before, 4); assert.equal(c.audio.after, 4);
  assert.deepEqual(c.audio.changed, ['RUS Дубляж Netflix: EAC3 6ch → TrueHD 8ch Atmos']);
  assert.equal(c.audio.same.length, 2);                                  // MVO HDRezka и оригинал
  assert.deepEqual(c.audio.added, ['RUS VO Кубик в Кубе — AC3 2ch']);
  assert.deepEqual(c.audio.removed, ['RUS Авторский Яроцкий — AC3 2ch']);
  assert.equal(c.subs, '2 → 3 (рус: 1 → 2)');
  const lines = changesLines(c);
  assert.ok(lines.some(l => /было 4 дорожек, станет 4/.test(l)));
  assert.ok(changesLines(c, true).some(l => l === '  = без изменений: 2'));
});

test('[11-06] размер файла до/после', () => {
  assert.equal(sizeLine(60 * 1024 ** 3, 72.5 * 1024 ** 3), '60.0 ГБ → 72.5 ГБ (+12.5 ГБ)');
  assert.equal(sizeLine(60 * 1024 ** 3, 50 * 1024 ** 3), '60.0 ГБ → 50.0 ГБ (−10.0 ГБ)');
  assert.equal(sizeLine(undefined, undefined), undefined);
});

test('[11-06] одинаковое видео — «без изменений», дорожки без автора сопоставляются по порядку', () => {
  const v = { hdr: ['hdr10'], codec: 'HEVC' };
  const c = describeChanges(S(v, [T('rus', 'mvo', 'AC3', 6), T('rus', 'mvo', 'DTS', 6)]), S(v, [T('rus', 'mvo', 'AC3', 6)]));
  assert.deepEqual(c.video, ['без изменений (2160p HDR10)']);
  assert.equal(c.audio.same.length, 1);
  assert.deepEqual(c.audio.removed, ['RUS MVO — DTS 6ch']);
});
