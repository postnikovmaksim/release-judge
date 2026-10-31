import { statSync } from 'node:fs';
import { db } from './db.js';
import { radarr } from './radarr.js';
import { mediainfo, specFromMediainfo } from './spec/fromMediainfo.js';
import { doviInfo } from './spec/dovi.js';

const upsert = db.prepare(`INSERT INTO file_spec (movie_id, file_id, path, mtime, spec, updated_at)
  VALUES (@movie_id, @file_id, @path, @mtime, @spec, CURRENT_TIMESTAMP)
  ON CONFLICT(movie_id) DO UPDATE SET file_id=excluded.file_id, path=excluded.path, mtime=excluded.mtime, spec=excluded.spec, updated_at=CURRENT_TIMESTAMP`);
const known = db.prepare('SELECT file_id, mtime FROM file_spec WHERE movie_id = ?');

export async function runSnapshot(opts: { force?: boolean; log?: (m: string) => void } = {}) {
  const log = opts.log ?? console.log;
  const movies: any[] = await radarr('/movie');
  let done = 0, skipped = 0, failed = 0;
  for (const m of movies.filter(m => m.hasFile && m.movieFile)) {
    const f = m.movieFile;
    try {
      const mtime = Math.floor(statSync(f.path).mtimeMs);
      const k = known.get(m.id) as any;
      if (!opts.force && k && k.file_id === f.id && k.mtime === mtime) { skipped++; continue; }
      const spec = specFromMediainfo(await mediainfo(f.path), m.originalLanguage?.name === 'English' ? 'eng' : undefined);
      if (spec.video.hdr.includes('dv')) { const d = await doviInfo(f.path); spec.video.dvProfile = d.profile; (spec.video as any).dvEl = d.el; }
      upsert.run({ movie_id: m.id, file_id: f.id, path: f.path, mtime, spec: JSON.stringify(spec) });
      done++;
    } catch (e: any) { failed++; log(`snapshot fail ${m.title}: ${e.message}`); }
  }
  log(`snapshot: updated=${done} skipped=${skipped} failed=${failed}`);
  return { done, skipped, failed };
}

if (process.argv[1]?.endsWith('snapshot.js')) runSnapshot({ force: process.argv.includes('--force') }).then(() => process.exit(0));
