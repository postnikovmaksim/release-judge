import Fastify from 'fastify';
import { config, loadRules } from './config.js';
import { db } from './db.js';
import { runSnapshot } from './snapshot.js';

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

app.listen({ port: config.port, host: '0.0.0.0' });
