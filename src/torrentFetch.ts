import * as cheerio from 'cheerio';
import { fetchPage, fetchBinary } from './trackers/fetchPage.js';
import { parseTorrent, type TorrentMeta } from './torrent/bencode.js';

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

/** Тот же файл на shfs: inode совпадает, размер совпадает (у разных многогигабайтных файлов — нет). */
export const sameFile = (s: { ino: number; size: number }, me: { ino: number; size: number }) => s.ino === me.ino && s.size === me.size;

/** .torrent раздачи по ссылке на тему — для метаданных (список файлов, тип контейнера). */
export async function fetchTorrent(topicUrl: string, tracker: string): Promise<{ buf?: Buffer; magnet?: string; meta?: TorrentMeta }> {
  const { html } = await fetchPage(topicUrl);
  const $ = cheerio.load(html);
  const links: string[] = [];
  $('a[href]').each((_, a) => { const h = $(a).attr('href')!; if (/download\.php\?id=|dl\.php\?t=|\/download\/|magnet:\?/i.test(h)) links.push(h); });
  const link = pickDownloadLink(tracker, topicUrl, links, $('base').attr('href'));
  if (!link) throw new Error('на странице нет ссылки на .torrent (раздача удалена или закрыта?)');
  if (link.startsWith('magnet:')) return { magnet: link };
  const buf = await fetchBinary(link, topicUrl);
  return { buf, meta: parseTorrent(buf) };
}
