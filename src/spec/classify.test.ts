import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyAudio, extractAuthor } from './classify.js';

test('classify typical track titles', () => {
  const c = (t: string, l = 'rus') => classifyAudio(t, l, 'eng');
  assert.equal(c('Дубляж Пифагор'), 'dub');
  assert.equal(c('Дубляж, Blu-ray CEE'), 'dub');
  assert.equal(c('Russian, Dub, Custom'), 'dub');
  assert.equal(c('D, Невафильм'), 'dub');
  assert.equal(c('DVO'), 'dvo');
  assert.equal(c('AVO Юрий Немахов'), 'avo');
  assert.equal(c('Одноголосый закадровый, А. Гаврилов'), 'avo');
  assert.equal(c('Многоголосый закадровый, Jaskier'), 'mvo');
  assert.equal(c('Commentary  by Robert Pattinson', 'eng'), 'commentary');
  assert.equal(c('Original Core', 'eng'), 'original');
  assert.equal(c('', 'eng'), 'original');
});

test('extract author', () => {
  assert.equal(extractAuthor('Дубляж Пифагор'), 'Пифагор');
  assert.equal(extractAuthor('AVO Юрий Немахов'), 'Юрий Немахов');
  assert.equal(extractAuthor('Одноголосый закадровый, А. Гаврилов'), 'А. Гаврилов');
  assert.equal(extractAuthor('Дубляж, Blu-ray CEE'), undefined);
});

test('bare author names are AVO', () => {
  assert.equal(classifyAudio('А. Гаврилов', 'rus', 'eng'), 'avo');
  assert.equal(classifyAudio('Ю. Сербин', 'rus', 'eng'), 'avo');
  assert.equal(classifyAudio('|Гаврилов, Андрей Юрьевич|', 'rus', 'eng'), 'avo');
  assert.equal(classifyAudio('Reanimedia 2.0', 'rus', 'jpn'), 'unknown');
});

test('explicit leading code wins over words in studio name', () => {
  assert.equal(classifyAudio('MVO, Дубляжная', 'rus', 'eng'), 'mvo');
  assert.equal(classifyAudio('Dub, MovieDalen', 'rus', 'eng'), 'dub');
  assert.equal(classifyAudio('| AVO Гоблин', 'rus', 'eng'), 'avo');
  assert.equal(classifyAudio('Дубляж Пифагор', 'rus', 'eng'), 'dub');
  assert.equal(classifyAudio('Vox Mediaworks', 'rus', 'eng'), 'unknown');
});
