import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { parseTorrent } from './bencode.js';

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
