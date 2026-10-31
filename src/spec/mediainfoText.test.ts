import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseMediainfoText, looksLikeMediainfo } from './mediainfoText.js';
import { specFromMediainfo, enrichAudio } from './fromMediainfo.js';
import { audioHints, descFlags } from './descFlags.js';

const fx = (n: string) => readFileSync(new URL(`../../test/fixtures/${n}`, import.meta.url), 'utf8');

test('RuTracker Twilight: DV P7 + HDR10, dub/dvo/avo, atmos, commentary', () => {
  const t = fx('twilight-rt.mediainfo.txt');
  assert.ok(looksLikeMediainfo(t));
  const s = specFromMediainfo(parseMediainfoText(t));
  assert.deepEqual(s.video.hdr.sort(), ['dv', 'hdr10']);
  assert.equal(s.video.dvProfile, 7);
  assert.equal(s.video.height, 2160);
  const rus = s.audio.filter(a => a.lang === 'rus').map(a => a.kind);
  assert.deepEqual(rus, ['dub', 'dvo', 'avo']);
  assert.ok(s.audio.some(a => a.lang === 'eng' && a.codec === 'TrueHD' && a.atmos && a.lossless));
  assert.ok(s.audio.some(a => a.kind === 'commentary'));
});

test('TeamHD Twilight: HDR10 via PQ/Commercial name, dub author from summary', () => {
  const s = specFromMediainfo(parseMediainfoText(fx('twilight-thd.mediainfo.txt')));
  assert.deepEqual(s.video.hdr, ['hdr10']);
  assert.equal(s.video.dvProfile, undefined);
  enrichAudio(s, audioHints('Аудио#1: Russian: 48 kHz/24-bit, DTS 5.1, ~755 kbps avg |Дубляж, West Video|\nАудио#2: Ukrainian: 48 kHz, AC3 5.1 |Многоголосый закадровый, West Video|'));
  assert.equal(s.audio[0].kind, 'dub');
  assert.equal(s.audio[0].author, 'West Video');
  assert.equal(s.audio[1].kind, 'mvo');
});

test('description flags', () => {
  assert.equal(descFlags('Видео: HEVC, HDR10, Dolby Vision 07.06 FEL').dvLayer, 'FEL');
  assert.equal(descFlags('[Локализованный видеоряд]').localized, true);
  assert.equal(descFlags('обычная раздача').localized, false);
});

test('RuTracker summary hints', () => {
  const h = audioHints('Аудио 1: Русский, DTS, 5.1, 48 kHz, 768 kbps, 24 bits / Dub Пифагор\nАудио 3: Русский, AC3 / AVO Юрий Немахов');
  assert.equal(h.get(1), 'Dub Пифагор');
  assert.equal(h.get(3), 'AVO Юрий Немахов');
});
