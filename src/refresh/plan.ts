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
