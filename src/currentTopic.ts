import { config } from './config.js';

/** Ссылка на раздачу, из которой скачан текущий файл: файл → media-hardlinks (inode) → торрент в qBit → comment. */
export interface QbTorrent { cp: string; comment: string; hash: string; instance: string; }
let cache: { at: number; torrents: QbTorrent[] } | null = null;

async function torrents() {
  if (cache && Date.now() - cache.at < 3600_000) return cache.torrents;
  const all: QbTorrent[] = [];
  for (const base of config.qbit.urls) {
    try {
      const r = await fetch(`${base}/api/v2/torrents/info`);
      if (!r.ok) continue;
      for (const t of (await r.json()) as any[]) all.push({ cp: t.content_path, comment: /^https?:\/\//.test(t.comment ?? '') ? t.comment : '', hash: t.hash, instance: base });
    } catch { /* инстанс недоступен — пропускаем */ }
  }
  cache = { at: Date.now(), torrents: all };
  return all;
}

/** Торрент, из которого лежит файл библиотеки (по hardlink). fresh — без кэша (перед заменой). */
export async function currentTorrent(filePath: string, fresh = false): Promise<QbTorrent | undefined> {
  if (fresh) cache = null;
  try {
    const r = await fetch(`${config.hardlinks.url}/hardlink`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paths: [filePath] }) });
    const tp: string | null = ((await r.json()) as any)[filePath];
    if (!tp) return undefined;
    return (await torrents()).find(x => tp === x.cp || tp.startsWith(x.cp + '/'));
  } catch { return undefined; }
}

export async function currentTopicUrl(filePath: string): Promise<string | undefined> {
  try {
    const r = await fetch(`${config.hardlinks.url}/hardlink`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paths: [filePath] }) });
    const tp: string | null = ((await r.json()) as any)[filePath];
    if (!tp) return undefined;
    const t = (await torrents()).find(x => tp === x.cp || tp.startsWith(x.cp + '/'));
    return t?.comment || undefined;
  } catch { return undefined; }
}
