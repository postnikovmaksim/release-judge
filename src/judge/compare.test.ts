import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import YAML from 'yaml';
import { parseMediainfoText } from '../spec/mediainfoText.js';
import { specFromMediainfo, enrichAudio, fillFromSummary } from '../spec/fromMediainfo.js';
import { audioHints, audioSummary } from '../spec/descFlags.js';
import { judge } from './compare.js';
import type { ReleaseSpec } from '../spec/schema.js';

const fx = (n: string) => readFileSync(new URL(`../../test/fixtures/${n}`, import.meta.url), 'utf8');
const rules = YAML.parse(readFileSync(new URL('../../config/rules.example.yaml', import.meta.url), 'utf8'));
const rt = (): ReleaseSpec => { const s = specFromMediainfo(parseMediainfoText(fx('twilight-rt.mediainfo.txt'))); s.video.dvLayer = 'FEL'; return s; };
const thd = (): ReleaseSpec => { const s = specFromMediainfo(parseMediainfoText(fx('twilight-thd.mediainfo.txt')));
  enrichAudio(s, audioHints('Аудио#1: Russian: DTS 5.1 |Дубляж, Пифагор|')); return s; };
const other = (s: ReleaseSpec) => { s.uniqueId = 'other'; return s; };
const noDur = (s: ReleaseSpec) => { s.durationSec = undefined; return s; };   // редакция по тексту — когда длительность неизвестна

test('Сумерки: файл RT (DV), кандидат TeamHD (HDR10) -> KEEP', () => {
  assert.equal(judge(rt(), thd(), rules, { year: 2008, candidateTracker: 'TeamHD' }).verdict, 'KEEP');
});
test('файл TeamHD HDR10, кандидат RT DV, та же студия дубляжа -> UPGRADE', () => {
  assert.equal(judge(thd(), rt(), rules, { year: 2008, currentTracker: 'TeamHD', candidateTracker: 'RuTracker' }).verdict, 'UPGRADE');
});
test('другая студия дубляжа -> REVIEW', () => {
  const cur = thd(); cur.audio[0].author = 'West Video';
  const j = judge(cur, rt(), rules, {});
  assert.equal(j.verdict, 'REVIEW');
  assert.ok(j.reasons.some(r => /студия/.test(r)));
});
test('тот же релиз -> KEEP', () => assert.match(judge(rt(), rt(), rules, {}).reasons[0], /тот же релиз/));
test('P8 и P7 FEL равны -> KEEP', () => {
  const cur = rt(); cur.video.dvProfile = 8; cur.video.dvLayer = undefined; cur.uniqueId = 'p8';
  assert.equal(judge(cur, rt(), rules, {}).verdict, 'KEEP');
});
test('HDR10+ поверх DV — лучше', () => {
  const c = other(rt()); c.video.hdr = ['dv', 'hdr10plus', 'hdr10'];
  assert.equal(judge(rt(), c, rules, {}).verdict, 'UPGRADE');
});
test('редакция (длительность неизвестна): файл Extended, кандидат Theatrical -> REJECT', () => {
  assert.equal(judge(noDur(thd()), noDur(other(rt())), rules, { currentEditionText: 'Two Towers Extended Edition', candidateEditionText: '[Theatrical Cut]' }).verdict, 'REJECT');
});
test('редакция (длительность неизвестна): кандидат длиннее -> REVIEW даже при худшем видео', () => {
  const j = judge(noDur(rt()), noDur(other(thd())), rules, { currentEditionText: 'Movie (2001)', candidateEditionText: 'Movie [Extended Edition]' });
  assert.equal(j.verdict, 'REVIEW');
  assert.ok(j.why?.some(w => /редакция/.test(w)));
});
test('дубляж lossless -> lossy -> REVIEW', () => {
  const cur = thd(); cur.audio[0].lossless = true; cur.audio[0].codec = 'DTS-HD MA';
  const j = judge(cur, rt(), rules, {});
  assert.equal(j.verdict, 'REVIEW');
  assert.ok(j.reasons.some(r => /lossless → lossy/.test(r)));
});
test('потеря дубляжа -> REJECT', () => {
  const c = rt(); c.audio = c.audio.filter(a => a.kind !== 'dub');
  assert.equal(judge(thd(), c, rules, {}).verdict, 'REJECT');
});
test('дубляж заявлен в названии, но не распознан -> не REJECT', () => {
  const c = rt(); c.audio = c.audio.filter(a => a.kind !== 'dub'); c.uniqueId = 'x';
  assert.notEqual(judge(thd(), c, rules, { candidateTitle: 'Movie [2008, UHD BDRemux] Dub + MVO' }).verdict, 'REJECT');
});
test('RUS(ext) -> REVIEW, не REJECT', () => {
  const c = rt(); c.audio = c.audio.filter(a => a.lang !== 'rus'); c.uniqueId = 'x';
  const j = judge(thd(), c, rules, { candidateTitle: 'Kimi no Na wa [RUS(ext),JAP] [2016, BDRemux, HDR10]' });
  assert.equal(j.verdict, 'REVIEW');
  assert.ok(j.reasons.some(r => /внешняя/.test(r)));
});
test('неизвестная русская дорожка у файла ≠ «нет дубляжа»', () => {
  const cur = thd(); cur.audio[0].kind = 'unknown'; cur.audio[0].author = undefined; cur.video.hdr = ['dv', 'hdr10'];
  assert.equal(judge(cur, other(rt()), rules, {}).verdict, 'KEEP');
});
test('русский фильм: оригинал — русская дорожка, дубляж не сравнивается', () => {
  const mk = (codec: string, lossless = false): ReleaseSpec => ({ video: { hdr: [], height: 1080, width: 1920, localized: false, upscale: false }, subs: [], confidence: 1,
    audio: [{ lang: 'rus', kind: 'unknown', codec, lossless, channels: 2 }] } as any);
  const j = judge(mk('FLAC', true), mk('AAC'), rules, { originalLang: 'rus' });
  assert.equal(j.verdict, 'KEEP');
});
test('потеря Гоблина у старого фильма -> REVIEW', () => {
  const cur = thd(); cur.audio.push({ lang: 'rus', kind: 'avo', author: 'Гоблин', codec: 'AC3', title: 'AVO Гоблин' } as any);
  const j = judge(cur, rt(), rules, { year: 2001 });
  assert.equal(j.verdict, 'REVIEW');
  assert.ok(j.reasons.some(r => /Гоблин/.test(r)));
});
test('локализованный видеоряд -> REVIEW', () => {
  const c = rt(); c.video.localized = true;
  assert.equal(judge(thd(), c, rules, {}).verdict, 'REVIEW');
});
test('сводка RuTor: дорожки достраиваются', () => {
  const c = rt(); c.audio = [];
  fillFromSummary(c, audioSummary('Аудио 1: Русский 48 kHz, AC3, 6 ch 448 Kbps - Дубляж\nАудио 6: Английский 48 kHz, DTS-X MA, 8ch - Оригинал'));
  assert.deepEqual(c.audio.map(a => `${a.lang}/${a.kind}`), ['rus/dub', 'eng/original']);
});

const aud = (xs: [string, string, string?, string?, boolean?][]) => xs.map(([lang, kind, author, codec = 'AC3', lossless = false]) =>
  ({ lang, kind, author, title: `${kind} ${author ?? ''}`, codec, lossless, channels: 6 }));
const base = (audio: any[], uid: string): ReleaseSpec => ({ video: { hdr: ['hdr10'], height: 2160, width: 3840, localized: false, upscale: false },
  subs: [], confidence: 1, uniqueId: uid, audio: [...audio, { lang: 'eng', kind: 'original', codec: 'TrueHD', lossless: true, channels: 8 }] } as any);

test('Конклав: тот же дубляж, студия не подписана у кандидата -> KEEP (флаги без выигрыша не повод)', () => {
  const j = judge(base(aud([['rus', 'dub', 'Пифагор', 'EAC3']]), 'a'), base(aud([['rus', 'dub', undefined, 'AC3'], ['rus', 'dub', undefined, 'EAC3']]), 'b'), rules, {});
  assert.equal(j.verdict, 'KEEP');
});
test('Индиана: «Dub, Licence» у кандидата = официальная MVO у файла -> не выигрыш по дубляжу', () => {
  const cur = base([{ lang: 'rus', kind: 'mvo', author: 'UHD', title: 'Многоголосый закадровый, UHD-BD', codec: 'DTS-HD MA', lossless: true, channels: 2 }], 'a');
  const cnd = base([{ lang: 'rus', kind: 'dub', author: 'Licence', title: 'Dub, Licence', codec: 'AC3', channels: 2 }], 'b');
  assert.equal(judge(cur, cnd, rules, {}).verdict, 'KEEP');
});
test('Серенити: дубляж lossy -> lossless = выигрыш, метки Amazon/ATMOS не студии', () => {
  const j = judge(base(aud([['rus', 'dub', 'Amazon', 'EAC3']]), 'a'), base(aud([['rus', 'dub', 'ATMOS)', 'DTS-HD MA', true]]), 'b'), rules, {});
  assert.equal(j.verdict, 'UPGRADE');
  assert.ok(j.why?.some(w => /дубляж/.test(w)));
});
test('разные реальные студии при выигрыше -> REVIEW с «Проверить»', () => {
  const j = judge(base(aud([['rus', 'dub', 'Невафильм']]), 'a'), { ...base(aud([['rus', 'dub', 'Пифагор', 'DTS-HD MA', true]]), 'b') }, rules, {});
  assert.equal(j.verdict, 'REVIEW');
  assert.ok(j.check?.some(c => /студия/.test(c)));
});
