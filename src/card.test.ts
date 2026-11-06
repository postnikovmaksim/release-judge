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

test('[11-07] Хоббит: одинаковые раздачи (размер ±0,1%) склеиваются — предлагаем одну, остальные «ещё на»', async () => {
  const { groupSame } = await import('./card.js');
  const mk = (id: number, tracker: string, size: number, verdict = 'REVIEW', confidence = 1): any => ({ id, tracker, topicUrl: `https://${tracker}/${id}`, candidateSize: size, verdict, confidence, reasons: [] });
  const g = groupSame([mk(1, 'RuTracker', 116.0e9), mk(2, 'NNM', 116.05e9, 'REVIEW', 0.5), mk(3, 'Tapochek', 116.02e9), mk(4, 'Kinozal', 90e9)], ['TeamHD', 'Tapochek']);
  assert.equal(g.length, 2);
  assert.equal(g[0].tracker, 'Tapochek');                                         // выше по лесенке
  assert.deepEqual(g[0].mirrors!.map(m => m.tracker).sort(), ['NNM', 'RuTracker']);
  assert.equal(g[1].tracker, 'Kinozal');                                          // другой размер — отдельная раздача
  const h = groupSame([mk(5, 'Tapochek', 50e9, 'REVIEW', 0.5), mk(6, 'RuTracker', 50e9, 'REVIEW', 1)]);
  assert.equal(h[0].tracker, 'RuTracker');                                        // разбор по MediaInfo важнее трекера
});
test('[11-07] UPGRADE тоже показывает «картину целиком»', async () => {
  const { renderCard } = await import('./card.js');
  const t = renderCard('Мулан', 'x', [{ id: 1, verdict: 'UPGRADE', topicUrl: 'u', candidateTitle: 'Mulan', reasons: [], why: ['видео'],
    changes: { video: ['HDR: 2160p HDR10 → 2160p DV P8 + HDR10'], audio: { before: 2, after: 2, same: ['a', 'b'], changed: [], added: [], removed: [] } } } as any]);
  assert.match(t, /Картина целиком/);
});
