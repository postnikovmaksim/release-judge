import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isDiscLayout, mayBeDisc } from './container.js';

test('[11-06] Храброе сердце TeamHD «BDRemux»: в .torrent BDMV/STREAM/00000.m2ts — структура диска', () => {
  assert.ok(isDiscLayout(['BDMV/STREAM/00000.m2ts', 'BDMV/MovieObject.bdmv', 'BDMV/BACKUP/PLAYLIST/00000.mpls']));
  assert.ok(!isDiscLayout(['Braveheart.1995.2160p.Remux.mkv']));
  assert.ok(!isDiscLayout(['Movie/Movie.mkv', 'Movie/Extras/featurette.mkv']));
  assert.ok(mayBeDisc('<pre>Disc Label: Braveheart.1995.2160p.DV.HDR.BDRemux.TeamHD</pre>', false));
  assert.ok(!mayBeDisc('<pre>Complete name : Movie.mkv</pre>', false));
});
