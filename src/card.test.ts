import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitCard, renderCard } from './card.js';

const track = (n: number) => `RUS Авторский Переводчик-${n} — DTS-HD MA 8ch · 4.2 Мбит/с`;
const item = (id: number, n: number): any => ({ id, verdict: 'REVIEW', topicUrl: 'https://x/t', candidateTitle: 'Властелин колец: Две крепости Extended UHD BDRemux', reasons: [],
  why: ['русский дубляж: нет → AC3 6ch (Мосфильм-Мастер + Позитив Мультимедиа на Extended Edition)'], check: ['дубляж со вставками закадрового перевода'],
  currentSize: 90e9, candidateSize: 95e9,
  changes: { video: ['без изменений (2160p HDR10)'], audio: { before: n, after: n, same: Array.from({ length: n }, (_, i) => track(i)),
    changed: Array.from({ length: n }, (_, i) => track(i) + ' → AC3'), added: Array.from({ length: n }, (_, i) => track(i + 100)), removed: [] } } });

test('[11-06] длинная карточка (ВК, Бегущий по лезвию): не обрезаем HTML посередине — вписываем в лимит с закрытыми тегами', () => {
  const items = [item(1, 30), item(2, 30), item(3, 30)];
  assert.ok(renderCard('ВК', 'x', items).length > 4000);
  const one = fitCard('ВК', 'x', [items[0]])!;
  assert.ok(one.length <= 4000);
  assert.equal((one.match(/<blockquote/g) ?? []).length, (one.match(/<\/blockquote>/g) ?? []).length);
  assert.match(one, /… ещё \d+ строк/);
});
