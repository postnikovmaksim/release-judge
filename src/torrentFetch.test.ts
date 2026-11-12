import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickDownloadLink, sameFile } from './torrentFetch.js';

test('[11-05] TeamHD: на странице и соседние релизы — берём .torrent с id самой темы', () => {
  const links = ['download.php?id=31634&name=a.torrent', 'download.php?id=31635&name=b.mkv.torrent', 'download.php?id=36570&name=c.torrent'];
  assert.equal(pickDownloadLink('TeamHD', 'https://teamhd.org/details/id31635', links, 'https://teamhd.org'), 'https://teamhd.org/download.php?id=31635&name=b.mkv.torrent');
  assert.equal(pickDownloadLink('TeamHD', 'https://teamhd.org/details/id99', links), undefined);
  assert.equal(pickDownloadLink('RuTracker', 'https://rutracker.org/forum/viewtopic.php?t=1', ['dl.php?t=1', 'magnet:?xt=urn:btih:AB']), 'https://rutracker.org/forum/dl.php?t=1');
  assert.equal(pickDownloadLink('Kinozal', 'https://kinozal.me/details.php?id=5', ['/download.php?id=5']), 'https://kinozal.me/download.php?id=5');
});

test('[11-05 вечер] cross-seed на Unraid: одинаковый inode с разных дисков — не тот же файл, нужен ещё размер', () => {
  assert.equal(sameFile({ ino: 1234, size: 19e9 }, { ino: 1234, size: 19e9 }), true);
  assert.equal(sameFile({ ino: 1234, size: 80e9 }, { ino: 1234, size: 19e9 }), false);   // «300» vs ReZero
});
