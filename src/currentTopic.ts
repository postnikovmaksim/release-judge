import { config } from './config.js';

/** Ссылка на раздачу, из которой скачан текущий файл: файл → media-hardlinks (inode) → торрент в qBit → comment. */
let cache: { at: number; torrents: { cp: string; comment: string }[] } | null = null;

async function torrents() {
  if (cache && Date.now() - cache.at < 3600_000) return cache.torrents;
  const all: { cp: string; comment: string }[] = [];
  for (const base of config.qbit.urls) {
    try {
      const r = await fetch(`${base}/api/v2/torrents/info`);
      if (!r.ok) continue;
      for (const t of (await r.json()) as any[]) if (t.comment && /^https?:\/\//.test(t.comment)) all.push({ cp: t.content_path, comment: t.comment });
    } catch { /* инстанс недоступен — пропускаем */ }
  }
  cache = { at: Date.now(), torrents: all };
  return all;
}

export async function currentTopicUrl(filePath: string): Promise<string | undefined> {
  try {
    const r = await fetch(`${config.hardlinks.url}/hardlink`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paths: [filePath] }) });
    const tp: string | null = ((await r.json()) as any)[filePath];
    if (!tp) return undefined;
    const t = (await torrents()).find(x => tp === x.cp || tp.startsWith(x.cp + '/'));
    return t?.comment;
  } catch { return undefined; }
}
