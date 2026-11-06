import { config } from './config.js';
import { db, isIgnored, kvSet } from './db.js';
import { radarr } from './radarr.js';
import { judgeTopic, type JudgeResult } from './judge/service.js';
import { trackerFor } from './trackers/registry.js';
import { sendMovieCard, sendText } from './telegram.js';
import { currentTopicUrl } from './currentTopic.js';
import { parseTopic } from './topic.js';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
// Отклонения Radarr, которые означают «не апгрейд по мнению Radarr» — именно такие кандидаты нам и нужны
const UPGRADE_REJECTION = /existing file|not an upgrade|upgrade|custom format score|cutoff|already meets/i;

const recentlyJudged = db.prepare(`SELECT 1 FROM verdict WHERE movie_id = ? AND topic_url = ? AND created_at > datetime('now', ?)`);
const markChecked = db.prepare(`INSERT INTO movie_check (movie_id, checked_at, candidates, note) VALUES (?, CURRENT_TIMESTAMP, ?, ?)
  ON CONFLICT(movie_id) DO UPDATE SET checked_at = CURRENT_TIMESTAMP, candidates = excluded.candidates, note = excluded.note`);

/** Очередь: сначала никогда не проверявшиеся, потом самые давние. TeamHD-файлы с DV тоже проверяются, но реже не делаем — всё по кругу. */
function pickMovies(movies: any[], limit: number) {
  const checked = new Map((db.prepare('SELECT movie_id, checked_at FROM movie_check').all() as any[]).map(r => [r.movie_id, r.checked_at]));
  return movies
    .filter(m => m.hasFile && m.movieFile && db.prepare('SELECT 1 FROM file_spec WHERE movie_id = ?').get(m.id))
    .sort((a, b) => String(checked.get(a.id) ?? '').localeCompare(String(checked.get(b.id) ?? '')))
    .slice(0, limit);
}

export interface DiscoveryStats { movies: number; candidates: number; judged: number; upgrade: number; review: number; errors: number; }

export async function checkMovie(m: any, log: (s: string) => void, stats: DiscoveryStats, force = false) {
  const d = config.discovery;
  const fileQ = m.movieFile.quality?.quality?.id;   // тот же уровень = то же качество Radarr (Remux-2160p к Remux-2160p)
  const releases: any[] = await radarr(`/release?movieId=${m.id}`);
  const seen = new Set<string>();
  const cands = releases.filter(r => {
    if (d.excludeIndexerIds.includes(r.indexerId)) return false;
    if (r.quality?.quality?.id !== fileQ) return false;   // выше — дело Radarr, ниже (encode вместо remux) — не рассматриваем
    if (r.customFormatScore < 0) return false;                                   // BR-DISK, DV5, апскейл...
    if (!r.approved && r.rejections?.some((x: string) => !UPGRADE_REJECTION.test(x))) return false;
    const url = r.infoUrl;
    if (!url || !trackerFor(url) || seen.has(url)) return false;
    if (isIgnored(url, r.guid)) return false;
    if (!force && recentlyJudged.get(m.id, url, `-${d.recheckDays} days`)) return false;
    seen.add(url); return true;
  }).slice(0, d.maxCandidatesPerMovie);
  stats.candidates += cands.length;

  const results: JudgeResult[] = [];
  const curUrl = cands.length ? await currentTopicUrl(m.movieFile.path) : undefined;
  let currentTopicTitle: string | undefined;
  if (curUrl) try { currentTopicTitle = (await parseTopic(curUrl)).title; } catch { /* текущая раздача недоступна — не критично */ }
  for (const r of cands) {
    try {
      const j = await judgeTopic(m.id, r.infoUrl, { releaseSize: r.size, guid: r.guid, indexerId: r.indexerId, releaseTitle: r.title, indexer: r.indexer, movie: m, force, currentTopicTitle });
      stats.judged++;
      if (j.verdict === 'UPGRADE') stats.upgrade++;
      if (j.verdict === 'REVIEW') stats.review++;
      if (j.verdict === 'UPGRADE' || j.verdict === 'REVIEW') results.push(j);
    } catch (e: any) { stats.errors++; log(`judge ${m.title}: ${r.infoUrl}: ${e.message}`); }
  }
  markChecked.run(m.id, cands.length, null);
  if (results.length) {
    results.sort((a, b) => (a.verdict === 'UPGRADE' ? -1 : 1) - (b.verdict === 'UPGRADE' ? -1 : 1));
    const tracker = m.movieFile.releaseGroup ? ` · ${m.movieFile.releaseGroup}` : '';
    await sendMovieCard(m.id, `${m.title} (${m.year})`, `${m.movieFile.quality?.quality?.name ?? ''} ${results[0].currentLabel ?? ''}${tracker}`, results, curUrl);
  }
}

let running = false;
export async function runDiscovery(opts: { limit?: number; movieIds?: number[]; force?: boolean; log?: (s: string) => void } = {}) {
  if (running) return { started: false, reason: 'already running' };
  running = true;
  const log = opts.log ?? console.log;
  const stats: DiscoveryStats = { movies: 0, candidates: 0, judged: 0, upgrade: 0, review: 0, errors: 0 };
  try {
    const movies: any[] = await radarr('/movie');
    const list = opts.movieIds?.length ? movies.filter(m => opts.movieIds!.includes(m.id) && m.hasFile) : pickMovies(movies, opts.limit ?? config.discovery.limit);
    for (const m of list) {
      try { await checkMovie(m, log, stats, opts.force); stats.movies++; }
      catch (e: any) { stats.errors++; log(`discovery ${m.title}: ${e.message}`); }
      await sleep(config.discovery.delayMs);
    }
    kvSet('discovery_last', JSON.stringify({ at: new Date().toISOString(), ...stats }));
    log(`discovery: ${JSON.stringify(stats)}`);
    if (!opts.movieIds?.length)
      await sendText(`🌙 <b>Ночная проверка</b>: фильмов ${stats.movies}, кандидатов ${stats.candidates}, разобрано ${stats.judged}` +
        ` → 🔼 ${stats.upgrade} · 🤔 ${stats.review}${stats.errors ? ` · ⚠️ ошибок ${stats.errors}` : ''}`);
    return { started: true, ...stats };
  } finally { running = false; }
}

/** Простой планировщик: раз в минуту сверяем локальное время (TZ) с DISCOVERY_AT. */
export function scheduleDiscovery(log: (s: string) => void) {
  let lastDay = '';
  setInterval(() => {
    const now = new Date().toLocaleString('sv-SE', { timeZone: config.tz });   // "2026-10-31 02:30:00"
    const [day, time] = now.split(' ');
    if (time.slice(0, 5) === config.discovery.at && day !== lastDay) {
      lastDay = day;
      runDiscovery({ log }).catch(e => log(`discovery failed: ${e.message}`));
    }
  }, 60_000);
  log(`discovery scheduled daily at ${config.discovery.at} ${config.tz}`);
}
