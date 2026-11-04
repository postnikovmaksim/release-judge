import Fastify from 'fastify';
import { config, loadRules } from './config.js';
import { db } from './db.js';
import { runSnapshot } from './snapshot.js';
import { parseTopic } from './topic.js';
import { judgeTopic } from './judge/service.js';
import { runDiscovery, scheduleDiscovery } from './discovery.js';
import { startPolling, sendText } from './telegram.js';
import { addIgnore } from './db.js';

const app = Fastify({ logger: true });
const rules = loadRules();
let snapshotRunning = false;

app.get('/health', async () => ({ ok: true, mode: rules?.actions?.mode ?? 'report' }));

app.get('/stats', async () => ({
  files: db.prepare('SELECT count(*) n FROM file_spec').get(),
  topics: db.prepare('SELECT count(*) n FROM topic').get(),
  verdicts: db.prepare('SELECT verdict, count(*) n FROM verdict GROUP BY verdict').all(),
}));

app.post('/snapshot', async (req) => {
  if (snapshotRunning) return { started: false, reason: 'already running' };
  snapshotRunning = true;
  const force = (req.query as any)?.force === '1';
  runSnapshot({ force, log: m => app.log.info(m) }).finally(() => { snapshotRunning = false; });
  return { started: true, force };
});

app.get('/movie/:id/spec', async (req, reply) => {
  const row = db.prepare('SELECT * FROM file_spec WHERE movie_id = ?').get((req.params as any).id) as any;
  return row ? { ...row, spec: JSON.parse(row.spec) } : reply.code(404).send({ error: 'not found' });
});

app.post('/topic/parse', async (req, reply) => {
  const { url, force } = (req.body ?? {}) as { url?: string; force?: boolean };
  if (!url) return reply.code(400).send({ error: 'url required' });
  try { return await parseTopic(url, { force }); }
  catch (e: any) { return reply.code(502).send({ error: e.message }); }
});

app.post('/judge', async (req, reply) => {
  const { movieId, url, force } = (req.body ?? {}) as { movieId?: number; url?: string; force?: boolean };
  if (!movieId || !url) return reply.code(400).send({ error: 'movieId and url required' });
  try { return await judgeTopic(movieId, url, { force }); }
  catch (e: any) { return reply.code(502).send({ error: e.message }); }
});

app.get('/verdicts', async (req) => {
  const { limit = 50, verdict } = req.query as { limit?: number; verdict?: string };
  const rows = db.prepare(`SELECT * FROM verdict ${verdict ? 'WHERE verdict = ?' : ''} ORDER BY id DESC LIMIT ?`)
    .all(...(verdict ? [verdict, Number(limit)] : [Number(limit)])) as any[];
  return rows.map(r => ({ ...r, reasons: JSON.parse(r.reasons) }));
});

app.post('/discovery/run', async (req) => {
  const { limit, movieIds, force } = (req.body ?? {}) as { limit?: number; movieIds?: number[]; force?: boolean };
  if (movieIds?.length) return runDiscovery({ movieIds, force, log: m => app.log.info(m) });   // точечно — ждём результат
  runDiscovery({ limit, log: m => app.log.info(m) });
  return { started: true };
});

app.post('/telegram/test', async () => { await sendText('✅ release-judge подключён к боту'); return { ok: true }; });

app.post('/ignore/import', async (req) => {         // перенос игнор-листа (например, media_skip из n8n)
  const rows = (req.body ?? []) as { key: string; movieId?: number; title?: string }[];
  let n = 0; for (const r of rows) if (r.key) { addIgnore(r.key, r.movieId ?? null, r.title ?? null, 'import'); n++; }
  return { imported: n };
});

app.listen({ port: config.port, host: '0.0.0.0' }).then(() => {
  scheduleDiscovery(m => app.log.info(m));
  startPolling(m => app.log.info(m));
});
