/**
 * Исполнитель кнопки «Заменить» (решение Максима 2026-11-06):
 * Radarr качает выбранную раздачу (guid + indexerId) → после докачки импорт (сам Radarr или ManualImport, если для него
 * «не апгрейд» — одно качество) → старый торрент удаляется вместе с файлами, если их больше никто не раздаёт.
 */
import { statSync } from 'node:fs';
import { db } from './db.js';
import { radarr } from './radarr.js';
import { config } from './config.js';
import { sendText } from './telegram.js';
import { currentTorrent } from './currentTopic.js';
import { qb } from './refresh/clients.js';
import { sameFile } from './refresh/plan.js';

db.exec(`CREATE TABLE IF NOT EXISTS replace_job (
  verdict_id INTEGER PRIMARY KEY, movie_id INTEGER, title TEXT, release_title TEXT, guid TEXT, indexer_id INTEGER,
  old_hash TEXT, old_instance TEXT, old_file TEXT, old_size INTEGER, download_id TEXT,
  status TEXT, error TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP)`);
const upd = (id: number, f: Record<string, any>) => {
  const k = Object.keys(f);
  db.prepare(`UPDATE replace_job SET ${k.map(x => `${x} = @${x}`).join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE verdict_id = @id`).run({ ...f, id });
};
const esc = (s: string) => s.replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]!));
const ageMin = (j: any) => (Date.now() - Date.parse(j.updated_at + 'Z')) / 60_000;

/** Запуск по кнопке. Возвращает короткий текст для ответа на нажатие. */
export async function startReplace(verdictId: number): Promise<string> {
  const v = db.prepare('SELECT * FROM verdict WHERE id = ?').get(verdictId) as any;
  if (!v) throw new Error('вердикт не найден');
  if (!v.guid || !v.indexer_id) throw new Error('у вердикта нет guid/indexerId — запусти перепроверку фильма');
  // карточка могла устареть: по этой раздаче уже вынесен более новый вердикт (например, правила ужесточились — BDMV)
  const newer = db.prepare("SELECT verdict FROM verdict WHERE movie_id = ? AND topic_url = ? AND id > ? ORDER BY id DESC LIMIT 1").get(v.movie_id, v.topic_url, v.id) as any;
  if (newer && !["UPGRADE", "REVIEW"].includes(newer.verdict)) throw new Error(`вердикт устарел — по новым правилам ${newer.verdict}`);
  const existing = db.prepare("SELECT status FROM replace_job WHERE movie_id = ? AND status NOT IN ('done', 'error')").get(v.movie_id) as any;
  if (existing) return `по этому фильму замена уже идёт (${existing.status})`;
  const m = await radarr(`/movie/${v.movie_id}`);
  const old = m.movieFile?.path ? await currentTorrent(m.movieFile.path, true) : undefined;
  db.prepare(`INSERT OR REPLACE INTO replace_job (verdict_id, movie_id, title, release_title, guid, indexer_id, old_hash, old_instance, old_file, old_size, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'grabbing')`)
    .run(v.id, v.movie_id, `${m.title} (${m.year})`, v.release_title, v.guid, v.indexer_id, old?.hash ?? null, old?.instance ?? null, m.movieFile?.path ?? null, m.movieFile?.size ?? null);
  try {
    await grab(v.guid, v.indexer_id, v.movie_id);
    upd(v.id, { status: 'downloading' });
    return 'Radarr качает новую раздачу';
  } catch (e: any) {
    upd(v.id, { status: 'error', error: e.message });
    throw e;
  }
}

/** POST /release работает только по результатам из кэша поиска Radarr (~30 мин) — при промахе ищем заново. */
async function grab(guid: string, indexerId: number, movieId: number) {
  try { await radarr('/release', { method: 'POST', body: JSON.stringify({ guid, indexerId }) }); return; }
  catch (e: any) { if (!/404|not found|cache/i.test(e.message)) throw e; }
  await radarr(`/release?movieId=${movieId}`);
  await radarr('/release', { method: 'POST', body: JSON.stringify({ guid, indexerId }) });
}

async function queueItem(movieId: number, downloadId?: string) {
  const q = await radarr<any>(`/queue?pageSize=200&includeMovie=false&movieIds=${movieId}`);
  const items: any[] = q.records ?? q;
  return downloadId ? items.find(i => i.downloadId?.toLowerCase() === downloadId.toLowerCase()) : items.find(i => i.movieId === movieId);
}

/** Довести запущенные замены (раз в 2 минуты). */
export async function advanceReplaces(log: (m: string) => void) {
  const jobs = db.prepare(`SELECT * FROM replace_job WHERE status IN ('downloading', 'importing')`).all() as any[];
  for (const j of jobs) {
    try {
      const m = await radarr(`/movie/${j.movie_id}`);
      // импортировано: у фильма в Radarr другой файл (путь или размер)
      if (m.movieFile && (m.movieFile.path !== j.old_file || m.movieFile.size !== j.old_size)) { await finish(j, m, log); continue; }
      const qi = await queueItem(j.movie_id, j.download_id ?? undefined);
      if (qi && !j.download_id) upd(j.verdict_id, { download_id: qi.downloadId });
      if (j.status === 'downloading') {
        if (!qi) { if (ageMin(j) > 30) { upd(j.verdict_id, { status: 'error', error: 'раздачи нет в очереди Radarr' }); await sendText(`⚠️ <b>${esc(j.title)}</b>: Radarr не поставил раздачу в очередь — проверь Activity`); } continue; }
        if (qi.status === 'completed' || /importPending|importBlocked/i.test(qi.trackedDownloadState ?? '')) {
          if (/importBlocked/i.test(qi.trackedDownloadState ?? '') || ageMin(j) > 5) {   // одно качество — для Radarr «не апгрейд»: импортируем сами
            await manualImport(j, qi);
            upd(j.verdict_id, { status: 'importing', download_id: qi.downloadId });
          }
        }
        continue;
      }
      if (j.status === 'importing' && ageMin(j) > 30) {
        upd(j.verdict_id, { status: 'error', error: 'Radarr не импортировал файл за 30 мин' });
        await sendText(`⚠️ <b>${esc(j.title)}</b>: новая раздача скачана, но Radarr её не импортировал — Activity → Queue`);
      }
    } catch (e: any) { log(`replace ${j.title}: ${e.message}`); upd(j.verdict_id, { error: e.message }); }
  }
}

async function manualImport(j: any, qi: any) {
  const items = await radarr<any[]>(`/manualimport?downloadId=${qi.downloadId}&movieId=${j.movie_id}&filterExistingFiles=false`);
  const it = [...items].filter(i => /\.(mkv|mp4|m2ts|avi)$/i.test(i.path)).sort((a, b) => b.size - a.size)[0];
  if (!it) throw new Error('Radarr не видит файл для импорта');
  await radarr('/command', { method: 'POST', body: JSON.stringify({ name: 'ManualImport', importMode: 'auto', files: [{
    path: it.path, movieId: j.movie_id, downloadId: qi.downloadId, quality: it.quality, languages: it.languages,
    releaseGroup: it.releaseGroup, indexerFlags: it.indexerFlags ?? 0 }] }) });
}

/** Новый файл в библиотеке — удаляем старый торрент. С файлами — только если их не раздаёт другой торрент (cross-seed). */
async function finish(j: any, m: any, log: (m: string) => void) {
  let note = 'старый торрент не найден — удалять нечего';
  if (j.old_hash && j.old_instance) {
    const [old] = await qb(j.old_instance, `/torrents/info?hashes=${j.old_hash}`) as any[];
    if (old) {
      let withFiles = true;
      let me: { ino: number; size: number } | undefined;
      try { const s = statSync(old.content_path); if (s.isFile()) me = { ino: s.ino, size: s.size }; } catch { }
      for (const base of config.qbit.urls) {
        let l: any[]; try { l = await qb(base, '/torrents/info'); } catch { continue; }
        for (const x of l) {
          if (x.hash === j.old_hash) continue;
          if (x.content_path === old.content_path) withFiles = false;
          else if (me) { try { if (sameFile(statSync(x.content_path), me)) withFiles = false; } catch { } }
        }
      }
      await qb(j.old_instance, '/torrents/delete', { hashes: j.old_hash, deleteFiles: String(withFiles) });
      note = withFiles ? 'старый торрент удалён вместе с файлом' : 'старый торрент удалён, файл оставлен (его раздаёт ещё один торрент)';
    }
  }
  upd(j.verdict_id, { status: 'done', error: null });
  db.prepare("UPDATE verdict SET user_decision = 'replaced' WHERE id = ?").run(j.verdict_id);
  const gb = (b?: number) => (b ? `${(b / 1024 ** 3).toFixed(1)} ГБ` : '?');
  await sendText(`✅ <b>${esc(j.title)}</b>: заменено\n${esc(j.release_title ?? '')}\nРазмер: ${gb(j.old_size)} → ${gb(m.movieFile?.size)}\n${note}`);
  log(`replace done: ${j.title}`);
}

export function scheduleReplaces(log: (m: string) => void) {
  setInterval(() => advanceReplaces(log).catch(e => log(`replace: ${e.message}`)), 2 * 60_000);
}
export const replaceJobs = () => db.prepare('SELECT * FROM replace_job ORDER BY updated_at DESC LIMIT 50').all();
