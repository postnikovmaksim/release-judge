/** [11-05] Обновлённые раздачи — договорённости: сериалы автоматом на тот же путь; фильмы всегда перекачиваем, но поверх hardlink не пишем. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { parseTorrent } from '../torrent/bencode.js';
import { isUnregistered, pickDownloadLink, diffFiles, strategy, kindOf } from './plan.js';

const be = (v: any): Buffer => {
  if (typeof v === 'number') return Buffer.from(`i${v}e`);
  if (typeof v === 'string' || Buffer.isBuffer(v)) { const b = Buffer.from(v as any); return Buffer.concat([Buffer.from(`${b.length}:`), b]); }
  if (Array.isArray(v)) return Buffer.concat([Buffer.from('l'), ...v.map(be), Buffer.from('e')]);
  const keys = Object.keys(v).sort();
  return Buffer.concat([Buffer.from('d'), ...keys.flatMap(k => [be(k), be(v[k])]), Buffer.from('e')]);
};
const multi = (name: string, files: [string, number][]) => {
  const info = { name, 'piece length': 16384, pieces: Buffer.alloc(20), files: files.map(([p, l]) => ({ length: l, path: p.split('/') })) };
  return { buf: be({ announce: 'http://x/ann', info }), hash: createHash('sha1').update(be(info)).digest('hex') };
};

test('[11-05] .torrent: infohash v1 и список файлов (корень папки не входит в путь)', () => {
  const t = multi('Show S01', [['E01.mkv', 100], ['Subs/E01.ass', 5]]);
  const m = parseTorrent(t.buf);
  assert.equal(m.infoHash, t.hash);
  assert.equal(m.name, 'Show S01');
  assert.deepEqual(m.files.map(f => f.path), ['E01.mkv', 'Subs/E01.ass']);
  assert.ok(m.multiFile);
});

test('[11-05] сигнал «раздачу перезалили» — только явный ответ трекера, не сетевые ошибки', () => {
  for (const m of ['unregistered torrent', 'Torrent not registered with this tracker', 'info hash is not authorized with this tracker']) assert.ok(isUnregistered(m), m);
  for (const m of ['Host not found (authoritative)', 'timed out', 'Connection refused', 'skipping tracker announce (unreachable)', '']) assert.ok(!isUnregistered(m), m);
});

test('[11-05] TeamHD: на странице и соседние релизы — берём .torrent с id самой темы', () => {
  const links = ['download.php?id=31634&name=a.torrent', 'download.php?id=31635&name=b.mkv.torrent', 'download.php?id=36570&name=c.torrent'];
  assert.equal(pickDownloadLink('TeamHD', 'https://teamhd.org/details/id31635', links, 'https://teamhd.org'), 'https://teamhd.org/download.php?id=31635&name=b.mkv.torrent');
  assert.equal(pickDownloadLink('TeamHD', 'https://teamhd.org/details/id99', links), undefined);
  assert.equal(pickDownloadLink('RuTracker', 'https://rutracker.org/forum/viewtopic.php?t=1', ['dl.php?t=1', 'magnet:?xt=urn:btih:AB']), 'https://rutracker.org/forum/dl.php?t=1');
  assert.equal(pickDownloadLink('Kinozal', 'https://kinozal.me/details.php?id=5', ['/download.php?id=5']), 'https://kinozal.me/download.php?id=5');
});

test('[11-05] сериал: добавились серии, корень переименован — тот же путь, старые серии сохраняются', () => {
  const old = [{ name: 'Show [WEB-DL]/E01.mkv', size: 100 }, { name: 'Show [WEB-DL]/E02.mkv', size: 200 }];
  const m = parseTorrent(multi('Show [WEB-DL 1080p]', [['E01.mkv', 100], ['E02.mkv', 200], ['E03.mkv', 300]]).buf);
  const d = diffFiles(old, m, true);
  assert.deepEqual(d.added, ['E03.mkv']);
  assert.ok(d.keepsOld && !d.identical);
  assert.equal(d.oldRoot, 'Show [WEB-DL]'); assert.equal(d.newRoot, 'Show [WEB-DL 1080p]');
  assert.equal(strategy('tv', d), 'same_path');
});

test('[11-05] сериал с заменённой серией — тот же путь, докачка на месте, Sonarr переимпортирует (без .old)', () => {
  const d = diffFiles([{ name: 'S/E01.mkv', size: 100 }], parseTorrent(multi('S', [['E01.mkv', 150]]).buf), true);
  assert.deepEqual(d.changed, ['E01.mkv']);
  assert.equal(strategy('tv', d), 'same_path');
});

test('[11-05 вечер] фильм: файл заменён — на месте (докачка в тот же файл, hardlink библиотеки обновится); при cross-seed — рядом + Radarr', () => {
  const single = (name: string, len: number) => { const info = { name, length: len, 'piece length': 16384, pieces: Buffer.alloc(20) }; return be({ info }); };
  const d = diffFiles([{ name: 'Movie.2026.WEB-DL.mkv', size: 100 }], parseTorrent(single('Movie.2026.WEB-DL.v2.mkv', 120)), false);
  assert.ok(!d.identical);
  assert.equal(strategy('movie', d), 'same_path');
  assert.equal(strategy('movie', d, true), 'new_path');     // файл раздаёт ещё один торрент — не трогаем его
  const same = diffFiles([{ name: 'Movie.mkv', size: 100 }], parseTorrent(single('Movie.Remux.mkv', 100)), false);
  assert.ok(same.identical);
  assert.equal(strategy('movie', same), 'same_path');      // переименован, размер тот же → перепроверка, без перекачки
  const extras = diffFiles([{ name: 'M/M.mkv', size: 100 }], parseTorrent(multi('M', [['M.mkv', 100], ['Extras/x.mkv', 5]]).buf), true);
  assert.equal(strategy('movie', extras), 'same_path');   // добавились файлы — докачаются рядом в той же папке
});

test('[11-05] категории: tv / tv-imported — сериал, movies — фильм, прочее не трогаем', () => {
  assert.equal(kindOf('tv-imported'), 'tv'); assert.equal(kindOf('movies'), 'movie');
  assert.equal(kindOf('temp'), undefined); assert.equal(kindOf('cross-seed'), undefined);
});

test('[11-05 вечер] cross-seed на Unraid: одинаковый inode с разных дисков — не тот же файл, нужен ещё размер', async () => {
  const { sameFile } = await import('./plan.js');
  assert.equal(sameFile({ ino: 1234, size: 19e9 }, { ino: 1234, size: 19e9 }), true);
  assert.equal(sameFile({ ino: 1234, size: 80e9 }, { ino: 1234, size: 19e9 }), false);   // «300» vs ReZero
});

test('[11-05 вечер] номер серии из имени файла (реальные раздачи Tapochek)', async () => {
  const { parseEpisodeNumber } = await import('./plan.js');
  assert.equal(parseEpisodeNumber('Kusuriya no Hitorigoto 3 (WEBRip 1080p)/05. Kusuriya no Hitorigoto 3 (WEBRip 1080p).mkv'), 5);
  assert.equal(parseEpisodeNumber('Steel Ball Run JoJo no Kimyou na Bouken [WEB-DL 1080p]/Steel Ball Run JoJo no Kimyou na Bouken - 07 [WEB-DL NF 1080p AVC AAC].mkv'), 7);
  assert.equal(parseEpisodeNumber('Show/Show.S02E11.1080p.WEB-DL.mkv'), 11);
  assert.equal(parseEpisodeNumber('Cyberpunk Edgerunners 2 [2160p WEB-DL DV HDR10]/Cyberpunk Edgerunners 2 - 09 [2160p WEB-DL DV HDR10].mkv'), 9);
});

test('[11-05 вечер] Sonarr не узнаёт японские названия — сериал/сезон/сдвиг берём по совпадению размеров с библиотекой', async () => {
  const { planTvImport } = await import('./plan.js');
  const q = { quality: { id: 3 } }, l = [{ id: 1 }];
  const lib = [   // The Apothecary Diaries S03 (импорт копией, размеры как у неизменённых файлов раздачи)
    { seriesId: 51, seasonNumber: 3, episodeNumber: 1, size: 1071419873, quality: q, languages: l },
    { seriesId: 51, seasonNumber: 3, episodeNumber: 2, size: 1042887180, quality: q, languages: l },
    { seriesId: 51, seasonNumber: 3, episodeNumber: 3, size: 1060708526, quality: q, languages: l },
    { seriesId: 51, seasonNumber: 3, episodeNumber: 4, size: 1031874719, quality: q, languages: l },
  ];
  const d = 'Kusuriya no Hitorigoto 3 (WEBRip 1080p)/';
  const files = [[1, 1071419873], [2, 1054987404], [3, 1072231558], [4, 1066585732], [5, 1050728505]]
    .map(([n, s]) => ({ path: `${d}0${n}. Kusuriya no Hitorigoto 3 (WEBRip 1080p).mkv`, size: s }));
  const p = planTvImport(files, lib)!;
  assert.equal(p.seriesId, 51); assert.equal(p.seasonNumber, 3); assert.equal(p.offset, 0);
  assert.deepEqual(p.targets.map(t => t.episodeNumber), [2, 3, 4, 5]);   // 02–04 изменены, 05 новая; 01 тот же — не трогаем
  assert.equal(planTvImport(files, []), undefined);                      // ни одного совпадения — не угадываем
});

test('[11-06] Cyberpunk Edgerunners 2: все серии изменены — сериал определён заранее по старой раздаче, импортируем все новые версии', async () => {
  const { planTvImport } = await import('./plan.js');
  const lib = [1, 2, 3].map(n => ({ seriesId: 106, seasonNumber: 2, episodeNumber: n, size: 2.5e9 + n, quality: {}, languages: [] }));
  const d = 'Cyberpunk Edgerunners 2 [2160p WEB-DL DV HDR10]/';
  const files = [1, 2, 3].map(n => ({ path: `${d}Cyberpunk Edgerunners 2 - 0${n} [2160p WEB-DL DV HDR10].mkv`, size: 2.7e9 + n }));
  assert.equal(planTvImport(files, lib), undefined);                                   // по новым файлам — не с чем сопоставить
  const p = planTvImport(files, lib, { seriesId: 106, seasonNumber: 2, offset: 0 })!;   // карта со старой раздачи
  assert.deepEqual(p.targets.map(x => x.episodeNumber), [1, 2, 3]);
});
