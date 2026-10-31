import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import YAML from 'yaml';
import { parseMediainfoText } from '../spec/mediainfoText.js';
import { specFromMediainfo, enrichAudio } from '../spec/fromMediainfo.js';
import { audioHints } from '../spec/descFlags.js';
import { judge } from './compare.js';

const fx = (n: string) => readFileSync(new URL(`../../test/fixtures/${n}`, import.meta.url), 'utf8');
const rules = YAML.parse(readFileSync(new URL('../../config/rules.example.yaml', import.meta.url), 'utf8'));

const rt = () => { const s = specFromMediainfo(parseMediainfoText(fx('twilight-rt.mediainfo.txt'))); s.video.dvLayer = 'FEL'; return s; };
const thd = () => { const s = specFromMediainfo(parseMediainfoText(fx('twilight-thd.mediainfo.txt')));
  enrichAudio(s, audioHints('Аудио#1: Russian: DTS 5.1 |Дубляж, West Video|')); return s; };

test('Twilight: файл RuTracker (DV FEL), кандидат TeamHD (HDR10) -> KEEP', () => {
  const j = judge(rt(), thd(), rules, { year: 2008, currentTracker: undefined, candidateTracker: 'TeamHD' });
  assert.equal(j.verdict, 'KEEP');
  assert.match(j.reasons[0], /видео/);
});

test('Twilight: файл TeamHD, кандидат RuTracker (DV FEL) -> UPGRADE (трекер — только тай-брейк)', () => {
  const j = judge(thd(), rt(), rules, { year: 2008, currentTracker: 'TeamHD', candidateTracker: 'RuTracker' });
  assert.equal(j.verdict, 'UPGRADE');
});

test('то же, но без TeamHD у текущего -> чистый UPGRADE', () => {
  const j = judge(thd(), rt(), rules, { year: 2008, currentTracker: undefined, candidateTracker: 'RuTracker' });
  assert.equal(j.verdict, 'UPGRADE');
});

test('потеря дубляжа -> REJECT', () => {
  const cand = rt(); cand.audio = cand.audio.filter(a => a.kind !== 'dub');
  assert.equal(judge(thd(), cand, rules, {}).verdict, 'REJECT');
});

test('потеря Гоблина у старого фильма -> REVIEW', () => {
  const cur = thd(); cur.audio.push({ lang: 'rus', kind: 'avo', author: 'Гоблин', codec: 'AC3', title: 'AVO Гоблин' } as any);
  const j = judge(cur, rt(), rules, { year: 2001 });
  assert.equal(j.verdict, 'REVIEW');
  assert.ok(j.reasons.some(r => /Гоблин/.test(r)));
});

test('локализованный видеоряд -> REVIEW', () => {
  const cand = rt(); cand.video.localized = true;
  assert.equal(judge(thd(), cand, rules, {}).verdict, 'REVIEW');
});

test('равное видео/звук: TeamHD побеждает прочий трекер (тай-брейк)', () => {
  assert.equal(judge(rt(), rt(), rules, { currentTracker: undefined, candidateTracker: 'TeamHD' }).verdict, 'UPGRADE');
  assert.equal(judge(rt(), rt(), rules, { currentTracker: 'TeamHD', candidateTracker: 'RuTracker' }).verdict, 'KEEP');
});
