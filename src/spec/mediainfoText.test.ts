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

test('[11-05] Kinozal: страница + AJAX-вкладка «Релиз» → сводка с дорожками, уверенность < 1', async () => {
  const { extract, textFromHtml } = await import('../trackers/extract.js');
  const { specFromSummary } = await import('./summaryOnly.js');
  const { fillFromSummary } = await import('./fromMediainfo.js');
  const { audioSummary } = await import('./descFlags.js');
  const ex = extract('Kinozal', fx('totalrecall-kinozal.page.html'));
  assert.match(ex.title, /Вспомнить всё/);
  const desc = ex.description + '\n' + textFromHtml(fx('totalrecall-kinozal.tab0.html'));
  const s = specFromSummary(ex.title, desc)!;
  fillFromSummary(s, audioSummary(desc));
  assert.ok(s);
  assert.equal(s.video.height, 2160);
  assert.ok(s.video.hdr.includes('dv'));
  assert.ok(s.audio.length >= 20);
  assert.ok(s.audio.some(a => a.lang === 'rus' && a.kind === 'mvo' && a.lossless));
  assert.ok(s.audio.some(a => a.lang === 'eng' && a.codec === 'TrueHD' && a.atmos));
  assert.ok(s.confidence < 1);
});

test('[11-05] DV-профиль по сводке: только явные маркеры («5 x ЛО» ≠ P5), «Dolby Vision TV» = P8', async () => {
  const { dvProfileFromText } = await import('./summaryOnly.js');
  assert.equal(dvProfileFromText('Total Recall / 6 x ПМ, 7 x АП, 5 x ЛО, СТ / 4K, HEVC, HDR, Dolby Vision Profile 7 / ITA'), 7);
  assert.equal(dvProfileFromText('Видео: HEVC (Dolby Vision, Version 1.0, dvhe.08.06, BL+RPU)'), 8);
  assert.equal(dvProfileFromText('4K, HEVC, HDR, Dolby Vision TV / Blu-Ray Remux'), 8);
  assert.equal(dvProfileFromText('UHD BDRemux 2160p DV P5'), 5);
  assert.equal(dvProfileFromText('UHD BDRemux 2160p Dolby Vision, 5.1'), undefined);
});

test('[11-05] Kinozal без «Аудио N:» во вкладке: дорожки из сводки страницы + подписи вкладки', async () => {
  const { extract, textFromHtml } = await import('../trackers/extract.js');
  const { specFromSummary, kinozalAudioLines } = await import('./summaryOnly.js');
  const page = fx('totalrecall-kinozal-dvtv.page.html'), tab = textFromHtml(fx('totalrecall-kinozal-dvtv.tab0.html'));
  const ex = extract('Kinozal', page);
  const desc = kinozalAudioLines(textFromHtml(page), tab) + '\n' + ex.description + '\n' + tab;
  const s = specFromSummary(ex.title, desc)!;
  assert.ok(s);
  assert.equal(s.video.dvProfile, 8);
  assert.equal(s.audio.length, 1);
  assert.equal(s.audio[0].lang, 'rus');
  assert.equal(s.audio[0].kind, 'mvo');
  assert.equal(s.audio[0].codec, 'AC3');
});

test('[11-05] длительность: JSON-секунды, hh:mm:ss, «3 h 17 min», «1 ч. 53 мин.», BDInfo Length', async () => {
  const { parseDuration } = await import('./fromMediainfo.js');
  assert.equal(parseDuration('6796.792'), 6797);
  assert.equal(parseDuration('01:53:16.792'), 6796);
  assert.equal(parseDuration('3 h 17 min'), 11820);
  assert.equal(parseDuration('1 ч. 53 мин.'), 6780);
  assert.equal(parseDuration('1 ч. 44 м.'), 6240);              // RU MediaInfo «м.» — была потеря минут (ВК 3:55 → 3:00)
  assert.equal(parseDuration('3 ч. 55 м. 12 с.'), 14112);
  assert.equal(parseDuration('500 мс'), undefined);
  assert.equal(parseDuration('1 h 53 min 16 s'), 6796);
  const { parseBdinfo } = await import('./bdinfo.js');
  assert.equal(specFromMediainfo(parseBdinfo(fx('patriot-teamhd.bdinfo.txt'))).durationSec, 10507);
  assert.equal(specFromMediainfo(parseMediainfoText(fx('avatar3-tapochek.mediainfo.txt'))).durationSec, 11820);
});

test('[11-06] битрейт из текстового MediaInfo/сводок: kb/s, Mb/s, пробелы-разделители, Кбит/сек, «4194 Kbps/1509 Kbps»', async () => {
  const { parseBitrateKbps } = await import('./fromMediainfo.js');
  assert.equal(parseBitrateKbps('640000'), 640);
  assert.equal(parseBitrateKbps('448 kb/s'), 448);
  assert.equal(parseBitrateKbps('4 194 kb/s'), 4194);
  assert.equal(parseBitrateKbps('47.8 Mb/s'), 47800);
  assert.equal(parseBitrateKbps('640 Кбит/сек'), 640);
  assert.equal(parseBitrateKbps('Russian, 48.0 KHz, DTS-HD MA, 6 ch, 4194 Kbps/1509 Kbps - MVO'), 4194);
  const s = specFromMediainfo(parseMediainfoText(fx('avatar3-tapochek.mediainfo.txt')));
  assert.equal(s.video.bitrateKbps, 47800);
  assert.equal(s.audio[0].bitrateKbps, 448);
});

test('[11-06] Серенити NNM: русский MediaInfo «Канал(-ы) : 6 каналов» — число каналов, без «?ch»', () => {
  const s = specFromMediainfo(parseMediainfoText(fx('serenity-nnm.mediainfo.txt')));
  assert.equal(s.audio.length, 7);
  assert.ok(s.audio.every(a => typeof a.channels === 'number' && a.channels > 0), JSON.stringify(s.audio.map(a => a.channels)));
  assert.equal(s.audio[0].channels, 6);
  assert.equal(s.audio[0].bitrateKbps, 384);
});

test('[11-08] «Из Ада»: 5.1 в сводке — это 6 каналов, не 5 (LFE не отбрасываем)', async () => {
  const { channelsFromText, fillFromSummary } = await import('./fromMediainfo.js');
  const { audioSummary } = await import('./descFlags.js');
  assert.equal(channelsFromText('DTS-HD MA, 5.1, 4.0 Мбит/с'), 6);
  assert.equal(channelsFromText('TrueHD Atmos 7.1'), 8);
  assert.equal(channelsFromText('AC3, 2.0, 192 kbps'), 2);
  assert.equal(channelsFromText('Russian, AC3, 6 ch, 448 Kbps'), 6);
  const s = { video: { hdr: [] as any, localized: false, upscale: false }, audio: [], subs: [], confidence: 0.5 } as any;
  fillFromSummary(s, audioSummary('Аудио 1: Русский, DTS-HD MA, 5.1, 4.0 Мбит/с - MVO, Карусель\nАудио 2: Английский, DTS-HD MA, 5.1, 4.0 Мбит/с - Оригинал'));
  assert.equal(s.audio[0].channels, 6);   // было 5 — ломало сопоставление с «6ch» той же дорожки из MediaInfo файла
  assert.equal(s.audio[1].channels, 6);
});
