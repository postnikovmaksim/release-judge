/**
 * Обновлённые раздачи: трекер отвечает «torrent not registered» → берём новый .torrent со страницы темы и докачиваем.
 * Сериалы: тот же путь, перепроверка, изменённые и новые серии докачиваются на месте, импорт в Sonarr, старый торрент удаляется без данных.
 * Фильмы: тот же путь, докачка прямо в файл (hardlink библиотеки обновится), потом Radarr перечитывает файл.
 *   Если файл раздаёт ещё один торрент (cross-seed) — отдельная папка `_refresh`, импорт через Radarr, старый торрент удаляется с данными.
 */
import { statSync, chmodSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as cheerio from 'cheerio';
import { config } from '../config.js';
import { db } from '../db.js';
import { radarr } from '../radarr.js';
import { sendText } from '../telegram.js';
import { fetchPage, fetchBinary } from '../trackers/fetchPage.js';
import { trackerFor } from '../trackers/registry.js';
import { parseTorrent, type TorrentMeta } from '../torrent/bencode.js';
import { qb, sonarr } from './clients.js';
import { isUnregistered, pickDownloadLink, diffFiles, kindOf, strategy, fmtSize, sameFile, planTvImport, type LibEp, type TvMap, type FileDiff, type Kind } from './plan.js';

db.exec(`CREATE TABLE IF NOT EXISTS refresh_job (
  old_hash TEXT PRIMARY KEY, instance TEXT, name TEXT, category TEXT, kind TEXT, topic_url TEXT,
  new_hash TEXT, strategy TEXT, save_path TEXT, movie_id INTEGER, diff TEXT,
  status TEXT, error TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP)`);
try { db.exec('ALTER TABLE refresh_job ADD COLUMN tv_map TEXT'); } catch { }
const upd = (h: string, f: Record<string, any>) => {
  const keys = Object.keys(f);
  db.prepare(`UPDATE refresh_job SET ${keys.map(k => `${k} = @${k}`).join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE old_hash = @h`).run({ ...f, h });
};
const esc = (s: string) => s.replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]!));

export interface Candidate { instance: string; hash: string; name: string; category: string; kind: Kind; savePath: string; contentPath: string; topicUrl: string; tracker: string; msg: string; }

/** Все раздачи, которые трекер «забыл». Публичные/без ссылки на тему пропускаем. */
export async function detect(): Promise<Candidate[]> {
  const out: Candidate[] = [];
  for (const base of config.qbit.urls) {
    let list: any[];
    try { list = await qb(base, '/torrents/info?includeTrackers=true'); } catch { continue; }
    for (const t of list) {
      const kind = kindOf(t.category ?? '');
      if (!kind || !config.refresh.categories.includes(t.category)) continue;
      const bad = (t.trackers ?? []).find((x: any) => isUnregistered(x.msg));
      if (!bad) continue;
      const props = await qb(base, `/torrents/properties?hash=${t.hash}`);
      const url = String(props.comment ?? '').match(/https?:\/\/\S+/)?.[0];
      const tr = url ? trackerFor(url) : undefined;
      if (!url || !tr) continue;
      out.push({ instance: base, hash: t.hash, name: t.name, category: t.category, kind, savePath: t.save_path, contentPath: t.content_path, topicUrl: url, tracker: tr.id, msg: bad.msg });
    }
  }
  return out;
}

/** Новый .torrent со страницы темы. */
export async function fetchNewTorrent(c: Pick<Candidate, 'topicUrl' | 'tracker'>): Promise<{ buf?: Buffer; magnet?: string; meta?: TorrentMeta; link: string }> {
  const { html } = await fetchPage(c.topicUrl);
  const $ = cheerio.load(html);
  const links: string[] = [];
  $('a[href]').each((_, a) => { const h = $(a).attr('href')!; if (/download\.php\?id=|dl\.php\?t=|\/download\/|magnet:\?/i.test(h)) links.push(h); });
  const link = pickDownloadLink(c.tracker, c.topicUrl, links, $('base').attr('href'));
  if (!link) throw new Error('на странице нет ссылки на .torrent (раздача удалена или закрыта?)');
  if (link.startsWith('magnet:')) return { magnet: link, link };
  const buf = await fetchBinary(link, c.topicUrl);
  return { buf, meta: parseTorrent(buf), link };
}

async function findMovieId(contentPath: string): Promise<number | undefined> {
  let ino: number;
  try { ino = statSync(contentPath).ino; } catch { return undefined; }
  const size = statSync(contentPath).size;
  for (const r of db.prepare('SELECT movie_id, path FROM file_spec').all() as any[]) {
    try { if (sameFile(statSync(r.path), { ino, size })) return r.movie_id; } catch { /* файл мог уйти */ }
  }
  return undefined;
}

export interface PlanItem { candidate: Candidate; newHash?: string; strategy?: 'same_path' | 'new_path'; diff?: FileDiff; movieId?: number; tvMap?: TvMap; note: string; }

/** Разобрать кандидата без действий (для /refresh/plan и как первый шаг run). */
export async function analyse(c: Candidate): Promise<PlanItem & { _buf?: Buffer; _meta?: TorrentMeta; _magnet?: string }> {
  const n = await fetchNewTorrent(c);
  if (n.magnet) return { candidate: c, strategy: c.kind === 'tv' ? 'same_path' : 'new_path', note: 'magnet (файлы станут известны после метаданных)', _magnet: n.magnet };
  const meta = n.meta!;
  if (meta.infoHash === c.hash) return { candidate: c, newHash: meta.infoHash, note: 'хэш на трекере тот же — раздачу не перезаливали (проблема трекера?)' };
  const files = await qb(c.instance, `/torrents/files?hash=${c.hash}`) as any[];
  const oldMulti = files.length > 1 || files[0]?.name.includes('/');
  const diff = diffFiles(files.map(f => ({ name: f.name, size: f.size })), meta, oldMulti);
  const shared = c.kind === 'movie' ? await sharedWith(c) : undefined;
  const st = strategy(c.kind, diff, !!shared);
  const movieId = c.kind === 'movie' ? await findMovieId(c.contentPath) : undefined;
  const note = c.kind === 'tv'
    ? `+${diff.added.length} новых файлов, ${diff.changed.length} изменено, ${diff.removed.length} убрано`
    : diff.identical ? 'файлы те же — только перепроверка'
    : shared ? `файл заменён (${fmtSize(meta.totalSize)}); его раздаёт ещё ${shared} — качаю рядом и импортирую в Radarr`
    : `файл заменён (${fmtSize(meta.totalSize)}) — докачиваю на месте`;
  // сериал определяем ДО докачки — по файлам старой раздачи (их копии лежат в библиотеке); после перезаписи сопоставлять будет не с чем
  let tvMap: TvMap | undefined;
  if (c.kind === 'tv') {
    try { const p = planTvImport(files.map(f => ({ path: f.name, size: f.size })), await sonarrLibrary()); if (p) tvMap = { seriesId: p.seriesId, seasonNumber: p.seasonNumber, offset: p.offset }; } catch { }
  }
  return { candidate: c, newHash: meta.infoHash, strategy: st, diff, movieId, tvMap, note: note + (c.kind === 'tv' && !tvMap ? '; сериал в Sonarr не определён' : ''), _buf: n.buf, _meta: meta };
}

const exists = async (hash: string) => {
  for (const base of config.qbit.urls) { try { const l = await qb(base, `/torrents/info?hashes=${hash}`); if (l.length) return base; } catch { } }
  return undefined;
};

/** Запустить обновление одной раздачи. */
async function start(c: Candidate, log: (m: string) => void) {
  db.prepare(`INSERT OR IGNORE INTO refresh_job (old_hash, instance, name, category, kind, topic_url, status) VALUES (?, ?, ?, ?, ?, ?, 'new')`)
    .run(c.hash, c.instance, c.name, c.category, c.kind, c.topicUrl);
  const a = await analyse(c);
  if (!a.strategy) { upd(c.hash, { status: 'skipped', error: a.note }); return; }
  if (c.kind === 'movie' && !a.movieId && a.strategy === 'new_path') throw new Error('не нашёл фильм в Radarr по hardlink текущего файла');
  if (a.newHash && await exists(a.newHash)) {          // уже добавлен (руками или прошлым прогоном)
    upd(c.hash, { new_hash: a.newHash, strategy: a.strategy, status: 'downloading', diff: JSON.stringify(a.diff ?? null), movie_id: a.movieId ?? null });
    return;
  }
  const savePath = a.strategy === 'same_path' ? c.savePath : join(c.savePath, '_refresh');
  const form = new FormData();
  if (a._buf) form.append('torrents', new Blob([new Uint8Array(a._buf)]), 'new.torrent'); else form.append('urls', a._magnet!);
  form.append('savepath', savePath); form.append('category', c.category); form.append('tags', 'refreshed');
  form.append('contentLayout', 'Original'); form.append('autoTMM', 'false');
  form.append('stopped', a.strategy === 'same_path' ? 'true' : 'false');   // на старом пути — сначала переименовать корень и перепроверить
  await qb(c.instance, '/torrents/add', form);
  const h = a.newHash;
  if (h && a.strategy === 'same_path') {
    await new Promise(r => setTimeout(r, 3000));
    if (!(await qb(c.instance, `/torrents/info?hashes=${h}`) as any[]).length) throw new Error('qBit не добавил новый торрент');
    // изменённые серии докачиваются прямо в файл (решение Максима 2026-11-05): Sonarr после докачки сам импортирует и заменит файл в media
    if (a.diff?.oldRoot && a.diff.newRoot && a.diff.oldRoot !== a.diff.newRoot)
      await qb(c.instance, '/torrents/renameFolder', { hash: h, oldPath: a.diff.newRoot, newPath: a.diff.oldRoot });
    if (a._meta && !a._meta.multiFile) {
      const oldName = c.contentPath.split('/').pop()!;
      if (oldName !== a._meta.name) await qb(c.instance, '/torrents/renameFile', { hash: h, oldPath: a._meta.name, newPath: oldName });
    }
    await makeWritable(c.instance, h);   // старые файлы бывают nobody:users 644 — qBit (PUID 1000) не сможет дописать: Permission denied
    await qb(c.instance, '/torrents/recheck', { hashes: h });
  }
  upd(c.hash, { new_hash: h ?? null, strategy: a.strategy, save_path: savePath, status: a.strategy === 'same_path' ? 'checking' : 'downloading', error: null, diff: JSON.stringify(a.diff ?? null), movie_id: a.movieId ?? null, tv_map: a.tvMap ? JSON.stringify(a.tvMap) : null });
  log(`refresh: ${c.name} → ${a.strategy} (${a.note})`);
  await sendText(`🔄 <b>Раздача обновлена</b>: ${esc(c.name)}\n${a.note}\n<a href="${c.topicUrl}">${c.tracker}</a>`);
}

/** Довести запущенные обновления до конца (вызывается раз в несколько минут). */
async function advance(log: (m: string) => void) {
  const jobs = db.prepare(`SELECT * FROM refresh_job WHERE status IN ('checking', 'downloading', 'importing')`).all() as any[];
  for (const j of jobs) {
    try {
      const [t] = await qb(j.instance, `/torrents/info?hashes=${j.new_hash}`) as any[];
      if (!t) { upd(j.old_hash, { status: 'error', error: 'новый торрент пропал из qBit' }); continue; }
      if (j.status === 'checking') {
        if (/checking/i.test(t.state)) continue;
        await qb(j.instance, '/torrents/start', { hashes: j.new_hash });   // фильм на месте: докачка изменившихся кусков прямо в файл
        upd(j.old_hash, { status: 'downloading' });
        continue;
      }
      if (j.status === 'downloading') {
        if (t.progress < 1) continue;
        if (j.kind === 'tv') {
          const res = await importTv(j, t);
          await removeOld(j, false);
          upd(j.old_hash, { status: 'done', error: res.ok ? null : res.text });
          await sendText(`${res.ok ? '✅' : '⚠️'} ${esc(j.name)}: докачано. ${esc(res.text)}`);
        } else if (j.strategy === 'same_path') {
          await removeOld(j, false);
          upd(j.old_hash, { status: 'done' });
          if (j.movie_id) await radarr('/command', { method: 'POST', body: JSON.stringify({ name: 'RescanMovie', movieId: j.movie_id }) }).catch(() => {});
          await dropFromRadarrQueue(j.new_hash).catch(() => {});
          await sendText(`✅ ${esc(j.name)}: новая версия раздачи докачана на месте${j.movie_id ? ', Radarr перечитал файл' : ''}`);
        } else {
          await importMovie(j, t);
          upd(j.old_hash, { status: 'importing' });
        }
        continue;
      }
      if (j.status === 'importing') {                  // ждём, пока Radarr переложит файл
        const m = await radarr(`/movie/${j.movie_id}`);
        const lib = m.movieFile?.path;
        const newFile = biggestFile(await qb(j.instance, `/torrents/files?hash=${j.new_hash}`), t.save_path);
        if (lib && newFile && statSync(lib).ino === statSync(newFile).ino) {
          await removeOld(j, true);
          upd(j.old_hash, { status: 'done' });
          await sendText(`✅ ${esc(m.title)} (${m.year}): новая версия раздачи импортирована, старая удалена`);
        } else if (Date.now() - Date.parse(j.updated_at + 'Z') > 30 * 60_000) {
          upd(j.old_hash, { status: 'error', error: 'Radarr не импортировал файл за 30 мин' });
          await sendText(`⚠️ ${esc(j.name)}: Radarr не импортировал новую версию — посмотри Activity → Manual Import`);
        }
      }
    } catch (e: any) {
      log(`refresh advance ${j.name}: ${e.message}`);
      upd(j.old_hash, { error: e.message });
    }
  }
}

const biggestFile = (files: any[], savePath: string) => {
  const f = [...files].sort((a, b) => b.size - a.size)[0];
  return f ? join(savePath, f.name) : undefined;
};

async function importMovie(j: any, t: any) {
  const folder = t.content_path.endsWith('.mkv') || t.content_path.endsWith('.mp4') ? dirname(t.content_path) : t.content_path;
  const items = await radarr<any[]>(`/manualimport?folder=${encodeURIComponent(folder)}&movieId=${j.movie_id}&filterExistingFiles=false`);
  const file = biggestFile(await qb(j.instance, `/torrents/files?hash=${j.new_hash}`), t.save_path);
  const it = items.find(i => i.path === file) ?? items.sort((a, b) => b.size - a.size)[0];
  if (!it) throw new Error('Radarr не увидел файл для импорта');
  const tracker = trackerFor(j.topic_url)?.id;
  await radarr('/command', { method: 'POST', body: JSON.stringify({ name: 'ManualImport', importMode: 'copy', files: [{
    path: it.path, movieId: j.movie_id, quality: it.quality, languages: it.languages,
    releaseGroup: tracker === 'TeamHD' || tracker === 'Tapochek' ? tracker : it.releaseGroup, indexerFlags: 0 }] }) });
}

/** Другой торрент (любой инстанс) раздаёт тот же файл фильма: тот же путь или hardlink (тот же inode). */
async function sharedWith(c: Candidate): Promise<string | undefined> {
  // Unraid /mnt/user (shfs) отдаёт inode нижних дисков — номера повторяются между дисками. Тот же файл = inode + размер + nlink>1.
  let me: { ino: number; size: number } | undefined;
  try { const s = statSync(c.contentPath); if (s.isFile() && s.nlink > 1) me = { ino: s.ino, size: s.size }; } catch { }
  for (const base of config.qbit.urls) {
    let l: any[]; try { l = await qb(base, '/torrents/info'); } catch { continue; }
    for (const x of l) {
      if (x.hash === c.hash) continue;
      if (x.content_path === c.contentPath) return `${x.category || 'торрент'} «${x.name}»`;
      if (me) { try { const s = statSync(x.content_path); if (sameFile(s, me)) return `${x.category || 'торрент'} «${x.name}»`; } catch { } }
    }
  }
  return undefined;
}

/** Удалить старый торрент. С данными — только если эти файлы не раздаёт другой торрент (cross-seed). */
async function removeOld(j: any, withData: boolean) {
  let del = withData;
  if (del) {
    const [old] = await qb(j.instance, `/torrents/info?hashes=${j.old_hash}`) as any[];
    if (!old) return;
    for (const base of config.qbit.urls) {
      const l = await qb(base, '/torrents/info') as any[];
      if (l.some(x => x.hash !== j.old_hash && x.content_path === old.content_path)) del = false;
    }
  }
  await qb(j.instance, '/torrents/delete', { hashes: j.old_hash, deleteFiles: String(del) });
}

/** Повторить: «хэш тот же» — раз в сутки; ошибка до запуска (сеть, трекер) — через час. Ошибки после запуска не повторяем. */
const retryable = (j: { status: string; strategy: string | null; updated_at: string }) => {
  const age = Date.now() - Date.parse(j.updated_at + 'Z');
  return (j.status === 'skipped' && age > 24 * 3600_000) || (j.status === 'error' && !j.strategy && age > 3600_000);
};

/** Один проход: найти новые обновлённые раздачи и продвинуть начатые. */
export async function runRefresh(log: (m: string) => void, opts: { dryRun?: boolean } = {}) {
  const found = await detect();
  const res: any[] = [];
  for (const c of found) {
    const job = db.prepare('SELECT status, strategy, updated_at FROM refresh_job WHERE old_hash = ?').get(c.hash) as any;
    if (job && job.status !== 'new' && !retryable(job)) continue;
    if (opts.dryRun) {
      try { const a = await analyse(c); res.push({ name: c.name, kind: c.kind, tracker: c.tracker, strategy: a.strategy, newHash: a.newHash, movieId: a.movieId, note: a.note, diff: a.diff && { added: a.diff.added.length, changed: a.diff.changed.length, removed: a.diff.removed.length, identical: a.diff.identical } }); }
      catch (e: any) { res.push({ name: c.name, error: e.message }); }
      continue;
    }
    try { await start(c, log); res.push({ name: c.name, ok: true }); }
    catch (e: any) {
      upd(c.hash, { status: 'error', error: e.message });
      res.push({ name: c.name, error: e.message });
      await sendText(`⚠️ Обновление раздачи не удалось: ${esc(c.name)}\n${esc(e.message)}\n<a href="${c.topicUrl}">${c.tracker}</a>`);
    }
  }
  if (!opts.dryRun) await advance(log);
  return { found: found.length, items: res };
}

export function scheduleRefresh(log: (m: string) => void) {
  if (!config.refresh.enabled) return;
  const tick = () => runRefresh(log).catch(e => log(`refresh: ${e.message}`));
  setTimeout(tick, 60_000);
  setInterval(tick, config.refresh.everyMin * 60_000);
  log(`refresh scheduled every ${config.refresh.everyMin} min`);
}

export const jobs = () => db.prepare('SELECT * FROM refresh_job ORDER BY updated_at DESC LIMIT 100').all();

/** Все файлы серий в Sonarr (размер → серия). Нужен один раз на прогон. */
async function sonarrLibrary(): Promise<LibEp[]> {
  const out: LibEp[] = [];
  for (const sr of await sonarr<any[]>('/series')) {
    if (!sr.statistics?.episodeFileCount) continue;
    const files = await sonarr<any[]>(`/episodefile?seriesId=${sr.id}`);
    if (!files.length) continue;
    const eps = await sonarr<any[]>(`/episode?seriesId=${sr.id}`);
    for (const f of files) for (const e of eps.filter(e => e.episodeFileId === f.id))
      out.push({ seriesId: sr.id, seasonNumber: e.seasonNumber, episodeNumber: e.episodeNumber, size: f.size, quality: f.quality, languages: f.languages });
  }
  return out;
}

/**
 * Импорт докачанных серий. Sonarr сам не узнаёт раздачи с японскими названиями («Unknown Series»), поэтому
 * сериал/сезон/сдвиг номеров определяем по неизменённым сериям (точный размер), новые и изменённые — ManualImport.
 */
async function importTv(j: any, t: any, override?: TvMap): Promise<{ ok: boolean; text: string }> {
  try {
    const files = (await qb(j.instance, `/torrents/files?hash=${j.new_hash}`) as any[]).map(f => ({ path: join(t.save_path, f.name), size: f.size }));
    const lib = await sonarrLibrary();
    const known: TvMap | undefined = override ?? (j.tv_map ? JSON.parse(j.tv_map) : undefined);
    const p = planTvImport(files, lib, known);
    if (!p) {
      await sonarr('/command', { method: 'POST', body: JSON.stringify({ name: 'DownloadedEpisodesScan', path: t.content_path, importMode: 'Copy' }) });
      return { ok: false, text: 'не нашёл сериал по уже импортированным сериям — отдал Sonarr на авто-импорт, проверь Activity → Queue' };
    }
    if (!p.targets.length) return { ok: true, text: 'новых/изменённых серий для импорта нет' };
    const eps = await sonarr<any[]>(`/episode?seriesId=${p.seriesId}`);
    const ref = lib.find(e => e.seriesId === p.seriesId && e.seasonNumber === p.seasonNumber)!;
    const items: any[] = [], missed: number[] = [];
    for (const tg of p.targets) {
      const ep = eps.find(e => e.seasonNumber === p.seasonNumber && e.episodeNumber === tg.episodeNumber);
      if (!ep) { missed.push(tg.episodeNumber); continue; }
      items.push({ path: tg.path, seriesId: p.seriesId, seasonNumber: p.seasonNumber, episodeIds: [ep.id], quality: ref.quality, languages: ref.languages, releaseGroup: trackerFor(j.topic_url)?.id ?? '', indexerFlags: 0, releaseType: 'singleEpisode' });
    }
    if (items.length) await sonarr('/command', { method: 'POST', body: JSON.stringify({ name: 'ManualImport', importMode: 'copy', files: items }) });
    const sr = await sonarr<any>(`/series/${p.seriesId}`);
    const list = items.map(i => 'E' + String(eps.find(e => e.id === i.episodeIds[0]).episodeNumber).padStart(2, '0')).join(', ');
    return { ok: !missed.length, text: `Sonarr: ${sr.title} S${String(p.seasonNumber).padStart(2, '0')} — импорт ${list}${missed.length ? `; нет в Sonarr серий ${missed.join(', ')}` : ''}` };
  } catch (e: any) { return { ok: false, text: `импорт в Sonarr не удался: ${e.message}` }; }
}

/** Ручной повтор импорта для уже завершённой работы (POST /refresh/import/:hash). */
export async function reimportTv(oldHash: string, override?: TvMap) {
  const j = db.prepare('SELECT * FROM refresh_job WHERE old_hash = ?').get(oldHash) as any;
  if (!j || j.kind !== 'tv') throw new Error('нет такой работы по сериалу');
  const [t] = await qb(j.instance, `/torrents/info?hashes=${j.new_hash}`) as any[];
  if (!t) throw new Error('новый торрент не найден в qBit');
  return importTv(j, t, override);
}

/** Файлы, которые новая раздача будет дописывать на месте, — rw для всех (стандарт Unraid 666). Hardlink в библиотеке — тот же inode, ему это не мешает. */
async function makeWritable(instance: string, hash: string) {
  const [t] = await qb(instance, `/torrents/info?hashes=${hash}`) as any[];
  if (!t) return;
  for (const f of await qb(instance, `/torrents/files?hash=${hash}`) as any[])
    for (const p of [join(t.save_path, f.name), join(t.save_path, f.name) + ".!qB"]) {
      try { const st = statSync(p); if ((st.mode & 0o666) !== 0o666) chmodSync(p, st.mode | 0o666); } catch { /* файла ещё нет */ }
    }
}

/** Radarr видит наш торрент в категории movies и держит его в очереди как «не апгрейд» — файл уже обновлён на месте, убираем запись (торрент не трогаем). */
export async function dropFromRadarrQueue(hash: string) {
  const q = await radarr<any>('/queue?pageSize=500&includeMovie=false');
  for (const it of (q.records ?? []) as any[])
    if (it.downloadId?.toLowerCase() === hash.toLowerCase())
      await radarr(`/queue/${it.id}?removeFromClient=false&blocklist=false`, { method: 'DELETE' });
}
