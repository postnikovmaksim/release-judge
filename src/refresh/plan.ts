/** Чистая логика обновления раздач (без сети) — покрыта тестами. */
import type { TorrentMeta } from '../torrent/bencode.js';

/** Трекер явно сказал «раздачи с таким хэшем нет» — её перезалили (или удалили). Таймауты/DNS сюда не попадают. */
export const UNREGISTERED = /not registered|unregistered|not authorized|torrent not found|not exist|не зарегистрир|не найден/i;
export const isUnregistered = (msg?: string) => !!msg && UNREGISTERED.test(msg);

/** Ссылка на .torrent со страницы темы. TeamHD показывает и соседние релизы фильма — берём ссылку с id самой темы. */
export function pickDownloadLink(tracker: string, topicUrl: string, links: string[], baseHref?: string): string | undefined {
  const base = baseHref ? new URL(baseHref.endsWith('/') ? baseHref : baseHref + '/', topicUrl).toString() : topicUrl;   // TeamHD: <base href="https://teamhd.org">
  const abs = (h: string) => (h.startsWith('magnet:') ? h : new URL(h, base).toString());
  const files = links.filter(h => !h.startsWith('magnet:'));
  if (tracker === 'TeamHD') {
    const id = topicUrl.match(/id(\d+)/)?.[1];
    const own = files.find(h => new RegExp(`[?&]id=${id}(&|$)`).test(h));
    return own ? abs(own) : undefined;
  }
  const f = files[0] ?? links.find(h => h.startsWith('magnet:'));
  return f ? abs(f) : undefined;
}

export interface OldFile { name: string; size: number; }      // как отдаёт qBit /torrents/files: путь от save_path, с корневой папкой
export interface FileDiff {
  oldRoot?: string; newRoot?: string;
  same: string[]; added: string[]; removed: string[]; changed: string[];
  /** все старые файлы есть в новой раздаче с тем же размером — можно класть на тот же путь и перепроверить */
  keepsOld: boolean;
  /** набор файлов идентичен (по относительным путям и размерам) */
  identical: boolean;
}

export function diffFiles(old: OldFile[], meta: TorrentMeta, oldMultiFile: boolean): FileDiff {
  const oldRoot = oldMultiFile ? old[0]?.name.split('/')[0] : undefined;
  const rel = (n: string) => (oldMultiFile ? n.split('/').slice(1).join('/') : n);
  const o = new Map(old.map(f => [rel(f.name), f.size]));
  const n = new Map(meta.files.map(f => [meta.multiFile ? f.path : f.path, f.size]));
  // одиночный файл переименован, размер тот же — считаем тем же файлом
  if (!oldMultiFile && !meta.multiFile && old.length === 1 && meta.files.length === 1 && old[0].size === meta.files[0].size) {
    return { same: [meta.files[0].path], added: [], removed: [], changed: [], keepsOld: true, identical: true };
  }
  const same: string[] = [], changed: string[] = [], removed: string[] = [], added: string[] = [];
  for (const [p, s] of o) { const ns = n.get(p); if (ns === undefined) removed.push(p); else if (ns === s) same.push(p); else changed.push(p); }
  for (const p of n.keys()) if (!o.has(p)) added.push(p);
  return { oldRoot, newRoot: meta.multiFile ? meta.name : undefined, same, added, removed, changed,
    keepsOld: oldMultiFile === meta.multiFile && !changed.length && !removed.length, identical: !changed.length && !removed.length && !added.length };
}

export type Kind = 'tv' | 'movie';
export const kindOf = (category: string): Kind | undefined => (/^tv/i.test(category) ? 'tv' : /^movies?/i.test(category) ? 'movie' : undefined);

/**
 * Куда класть новую раздачу (решение Максима 2026-11-05: всё автоматически, фильмы — на месте).
 * Сериал: всегда тот же путь (старые серии перепроверятся, докачаются новые).
 * Фильм: тот же путь — qBit перепроверит и докачает изменившиеся куски прямо в файл; библиотека смотрит на него hardlink-ом
 * и обновится сама. Исключение — файл раздаёт ещё один торрент (cross-seed): запись на месте сломала бы ту раздачу,
 * тогда — отдельная папка и импорт через Radarr.
 */
export function strategy(kind: Kind, _d: FileDiff, sharedWithOtherTorrent = false): 'same_path' | 'new_path' {
  if (kind === 'tv') return 'same_path';
  return sharedWithOtherTorrent ? 'new_path' : 'same_path';
}

export const fmtSize = (b: number) => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} ГБ` : `${Math.round(b / 1e6)} МБ`);

/** Тот же файл на shfs: inode совпадает, размер совпадает (у разных многогигабайтных файлов — нет). */
export const sameFile = (s: { ino: number; size: number }, me: { ino: number; size: number }) => s.ino === me.ino && s.size === me.size;


// ---------- сериалы: импорт докачанных серий в Sonarr ----------
/** Номер серии из имени файла: «S03E05», «… - 06 [WEB…]», «01. Kusuriya…», «EP07». */
export function parseEpisodeNumber(path: string): number | undefined {
  const name = path.split('/').pop()!.replace(/\.[a-z0-9]{2,4}$/i, '');
  const m = name.match(/S\d{1,2}E(\d{1,4})/i) ?? name.match(/\s-\s(\d{1,4})(?:v\d)?(?=[\s\[(._]|$)/) ?? name.match(/^(\d{1,4})(?:v\d)?[.\s_-]/)
    ?? name.match(/\b(?:EP?|Серия\s*)(\d{1,4})\b/i) ?? name.match(/\[(\d{1,4})(?:v\d)?\]/);
  return m ? Number(m[1]) : undefined;
}

export interface LibEp { seriesId: number; seasonNumber: number; episodeNumber: number; size: number; quality: any; languages: any; }
export interface TvImportPlan { seriesId: number; seasonNumber: number; offset: number; targets: { path: string; episodeNumber: number }[]; matched: number; }

/**
 * Файлы торрента → что импортировать. Неизменённые серии узнаём по точному размеру среди файлов Sonarr
 * (импорт мог быть копией, не hardlink) — отсюда сериал, сезон и сдвиг «номер в имени → номер серии».
 * Импортируем всё, чего в библиотеке нет с тем же размером: новые и изменённые серии.
 */
export interface TvMap { seriesId: number; seasonNumber: number; offset: number; }
export function planTvImport(files: { path: string; size: number }[], lib: LibEp[], known?: TvMap): TvImportPlan | undefined {
  if (known) {   // сериал определён заранее (по файлам старой раздачи) — импортируем всё, чего нет в библиотеке с тем же размером
    const have = new Set(lib.filter(e => e.seriesId === known.seriesId).map(e => e.size));
    const targets = files.filter(f => /\.(mkv|mp4|avi|m4v|ts)$/i.test(f.path) && !have.has(f.size))
      .map(f => ({ path: f.path, n: parseEpisodeNumber(f.path) })).filter(x => x.n !== undefined)
      .map(x => ({ path: x.path, episodeNumber: x.n! + known.offset }));
    return { ...known, matched: 0, targets };
  }
  const bySize = new Map<number, LibEp>();
  for (const e of lib) if (e.size > 50e6) bySize.set(e.size, e);
  const pairs: { n: number; e: LibEp }[] = [];
  const rest: { path: string; n?: number }[] = [];
  for (const f of files) {
    if (!/\.(mkv|mp4|avi|m4v|ts)$/i.test(f.path)) continue;
    const e = bySize.get(f.size), n = parseEpisodeNumber(f.path);
    if (e && n !== undefined) pairs.push({ n, e }); else if (!e) rest.push({ path: f.path, n });
  }
  if (!pairs.length) return undefined;
  const key = (p: { e: LibEp }) => `${p.e.seriesId}:${p.e.seasonNumber}`;
  const counts = new Map<string, number>();
  for (const p of pairs) counts.set(key(p), (counts.get(key(p)) ?? 0) + 1);
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const own = pairs.filter(p => key(p) === best);
  const offsets = new Set(own.map(p => p.e.episodeNumber - p.n));
  if (offsets.size !== 1) return undefined;                    // нумерация непоследовательна — не угадываем
  const offset = [...offsets][0];
  const [seriesId, seasonNumber] = best.split(':').map(Number);
  return { seriesId, seasonNumber, offset, matched: own.length,
    targets: rest.filter(r => r.n !== undefined).map(r => ({ path: r.path, episodeNumber: r.n! + offset })) };
}
