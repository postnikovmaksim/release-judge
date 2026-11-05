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

test('Tapochek Avatar 3: no General header, DV P7 + HDR10+ + HDR10, summary with pipes', () => {
  const t = fx('avatar3-tapochek.mediainfo.txt');
  assert.ok(looksLikeMediainfo(t));
  const s = specFromMediainfo(parseMediainfoText(t));
  assert.deepEqual([...s.video.hdr].sort(), ['dv', 'hdr10', 'hdr10plus']);
  assert.equal(s.video.dvProfile, 7);
  const hints = audioHints(' Аудио #8: | AC3 / 5.1 / 48 kHz / 640 kbps | MVO, Дубляжная \n Аудио #11: | Dolby TrueHD/Atmos Audio / 7.1+13 objects | Original ');
  assert.equal(hints.get(8), 'MVO, Дубляжная');
  enrichAudio(s, hints);
  assert.equal(s.audio[7].kind, 'mvo');
  assert.equal(s.audio[10].kind, 'original');
  assert.equal(s.audio[10].author, undefined);
});

test('NNM: русская локализация MediaInfo, 3840x1600', () => {
  const s = specFromMediainfo(parseMediainfoText(fx('xmen-nnm.mediainfo.txt')));
  assert.equal(s.video.width, 3840);
  assert.deepEqual(s.video.hdr, ['hdr10']);
  assert.ok(s.uniqueId);
  assert.ok(s.audio.some(a => a.lang === 'rus' && a.kind === 'dub'));
  assert.ok(s.audio.some(a => a.lang === 'rus' && a.kind === 'avo' && /Гаврилов/.test(a.author ?? '')));
});

test('RuTor: MediaInfo из textarea с <br />', () => {
  const s = specFromMediainfo(parseMediainfoText(fx('cinderella-rutor.mediainfo.txt')));
  assert.equal(s.video.height, 2160);
  assert.ok(s.audio.some(a => a.codec === 'DTS-HD MA' && a.lossless));
});

test('дубляж из названия раздачи, если дорожка подписана только студией', async () => {
  const { titleClaimsDub } = await import('./descFlags.js');
  const { applyTitleDub } = await import('./fromMediainfo.js');
  assert.ok(titleClaimsDub('Hercules [1997, BDRemux 1080p] Dub + 2x MVO + 4 AVO + Original Eng'));
  assert.ok(titleClaimsDub('Русалочка (1989) UHD BDRemux 2160p | 4K | HDR | D, P2, A'));
  assert.ok(!titleClaimsDub('Fake (2020) UHD BDRemux 2160p | 4K | HDR | Dolby Vision | P, A'));
  const s: any = { audio: [{ lang: 'rus', kind: 'unknown', title: '|Невафильм_1998г|' }, { lang: 'rus', kind: 'mvo' }] };
  applyTitleDub(s, true);
  assert.equal(s.audio[0].kind, 'dub');
});

test('язык из названия дорожки, если Language пуст', () => {
  const s = specFromMediainfo(parseMediainfoText('Video\nFormat : HEVC\nAudio #1\nFormat : AC-3\nTitle : RUS\nAudio #2\nFormat : AC-3\nTitle : Русский\nAudio #3\nFormat : DTS\nTitle : Rush commentary'));
  assert.deepEqual(s.audio.map(a => a.lang), ['rus', 'rus', 'und']);
});

test('TeamHD Патриот: BDInfo вместо MediaInfo — DV P7 + HDR10, TrueHD Atmos, типы дорожек из сводки', async () => {
  const { parseBdinfo, looksLikeBdinfo } = await import('./bdinfo.js');
  const { audioSummary } = await import('./descFlags.js');
  const { fillFromSummary } = await import('./fromMediainfo.js');
  const t = fx('patriot-teamhd.bdinfo.txt');
  assert.ok(looksLikeBdinfo(t));
  const s = specFromMediainfo(parseBdinfo(t));
  assert.equal(s.video.height, 2160);
  assert.deepEqual([...s.video.hdr].sort(), ['dv', 'hdr10']);
  assert.equal(s.video.dvProfile, 7);
  assert.equal(s.audio.length, 8);
  assert.ok(s.audio.some(a => a.lang === 'rus' && a.codec === 'TrueHD' && a.atmos && a.lossless));
  enrichAudio(s, audioHints(fx('patriot-teamhd.summary.txt')));
  fillFromSummary(s, audioSummary(fx('patriot-teamhd.summary.txt')));
  assert.equal(s.audio[0].kind, 'dub');
  assert.equal(s.audio[1].kind, 'mvo');
  assert.equal(s.audio[2].kind, 'avo');
});

test('раздача без дампа: спецификация по названию и сводке, уверенность < 1', async () => {
  const { specFromSummary } = await import('./summaryOnly.js');
  const s = specFromSummary('1917 (2019) UHD BDRemux 2160p [HDR10, Dolby Vision]',
    'Видео: HEVC, 3840x2160, HDR10, Dolby Vision\nАудио 1: Русский, TrueHD Atmos 7.1 / Дубляж\nАудио 2: Английский, TrueHD Atmos 7.1 / Original');
  assert.ok(s);
  assert.equal(s!.video.height, 2160);
  assert.ok(s!.video.hdr.includes('dv'));
  assert.equal(s!.audio[0].kind, 'dub');
  assert.ok(s!.confidence < 1);
});
