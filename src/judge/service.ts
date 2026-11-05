import { db } from '../db.js';
import { loadRules } from '../config.js';
import { radarr } from '../radarr.js';
import { parseTopic } from '../topic.js';
import { judge, type Judgement } from './compare.js';
import type { ReleaseSpec } from '../spec/schema.js';
import { normLang } from '../spec/classify.js';

const fileSpec = db.prepare('SELECT spec FROM file_spec WHERE movie_id = ?');
const saveVerdict = db.prepare(`INSERT INTO verdict (movie_id, topic_url, guid, indexer_id, verdict, reasons, decided_by, release_title, indexer)
  VALUES (@movie_id, @topic_url, @guid, @indexer_id, @verdict, @reasons, 'auto', @release_title, @indexer)`);

export interface JudgeResult extends Judgement { id: number; movieId: number; title: string; topicUrl: string; candidateTitle: string; currentLabel?: string; }
export interface JudgeOpts { force?: boolean; guid?: string; indexerId?: number; releaseTitle?: string; indexer?: string; movie?: any; currentTopicTitle?: string; }

export async function judgeTopic(movieId: number, url: string, opts: JudgeOpts = {}): Promise<JudgeResult> {
  const row = fileSpec.get(movieId) as any;
  if (!row) throw new Error(`нет снимка файла для movieId=${movieId} (POST /snapshot)`);
  const current: ReleaseSpec = JSON.parse(row.spec);
  const movie: any = opts.movie ?? await radarr(`/movie/${movieId}`);
  const topic = await parseTopic(url, { force: opts.force });
  if (!topic.spec) throw new Error(`не удалось разобрать раздачу (${topic.tracker}: нет MediaInfo)`);
  const mf = movie.movieFile ?? {};
  const j = judge(current, topic.spec, loadRules(), {
    year: movie.year,
    originalLang: movie.originalLanguage?.name ? normLang(movie.originalLanguage.name) : undefined,
    currentTracker: mf.releaseGroup ?? undefined,
    candidateTracker: topic.tracker,
    currentEditionText: [current.video.source, mf.edition, mf.relativePath, mf.originalFilePath, mf.sceneName, opts.currentTopicTitle].filter(Boolean).join(' '),
    candidateEditionText: [topic.title, opts.releaseTitle].filter(Boolean).join(' '),
    candidateTitle: [opts.releaseTitle, topic.title].filter(Boolean).join(' '),
  });
  const info = saveVerdict.run({ movie_id: movieId, topic_url: url, guid: opts.guid ?? null, indexer_id: opts.indexerId ?? null,
    verdict: j.verdict, reasons: JSON.stringify({ reasons: j.reasons, dims: j.dims }),
    release_title: opts.releaseTitle ?? topic.title, indexer: opts.indexer ?? topic.tracker });
  return { ...j, id: Number(info.lastInsertRowid), movieId, title: `${movie.title} (${movie.year})`, topicUrl: url,
    candidateTitle: opts.releaseTitle ?? topic.title, currentLabel: j.dims.find(d => d.dim === 'видео')?.current };
}
