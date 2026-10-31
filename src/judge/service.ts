import { db } from '../db.js';
import { loadRules } from '../config.js';
import { radarr } from '../radarr.js';
import { parseTopic } from '../topic.js';
import { judge, type Judgement } from './compare.js';
import type { ReleaseSpec } from '../spec/schema.js';

const fileSpec = db.prepare('SELECT spec FROM file_spec WHERE movie_id = ?');
const saveVerdict = db.prepare(`INSERT INTO verdict (movie_id, topic_url, guid, indexer_id, verdict, reasons, decided_by)
  VALUES (@movie_id, @topic_url, @guid, @indexer_id, @verdict, @reasons, 'auto')`);

export interface JudgeResult extends Judgement { movieId: number; title: string; topicUrl: string; candidateTitle: string; }

export async function judgeTopic(movieId: number, url: string, opts: { force?: boolean; guid?: string; indexerId?: number } = {}): Promise<JudgeResult> {
  const row = fileSpec.get(movieId) as any;
  if (!row) throw new Error(`нет снимка файла для movieId=${movieId} (POST /snapshot)`);
  const current: ReleaseSpec = JSON.parse(row.spec);
  const movie: any = await radarr(`/movie/${movieId}`);
  const topic = await parseTopic(url, { force: opts.force });
  if (!topic.spec) throw new Error(`не удалось разобрать раздачу (${topic.tracker}: нет MediaInfo)`);
  const j = judge(current, topic.spec, loadRules(), {
    year: movie.year,
    currentTracker: movie.movieFile?.releaseGroup ?? undefined,
    candidateTracker: topic.tracker,
  });
  saveVerdict.run({ movie_id: movieId, topic_url: url, guid: opts.guid ?? null, indexer_id: opts.indexerId ?? null,
    verdict: j.verdict, reasons: JSON.stringify({ reasons: j.reasons, dims: j.dims }) });
  return { ...j, movieId, title: `${movie.title} (${movie.year})`, topicUrl: url, candidateTitle: topic.title };
}
