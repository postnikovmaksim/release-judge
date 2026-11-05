import iconv from 'iconv-lite';
import { config } from '../config.js';
import { trackerFor } from './registry.js';
import { sessionFor } from './prowlarrSession.js';

const DEFAULT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

const fsSession = new Map<string, { cookie: string; userAgent?: string }>();

export class FetchError extends Error { constructor(msg: string, public status?: number) { super(msg); } }

function decode(buf: Buffer, contentType: string | null): string {
  const head = buf.subarray(0, 4096).toString('latin1');
  const cs = (contentType?.match(/charset=([\w-]+)/i)?.[1] ?? head.match(/charset=["']?([\w-]+)/i)?.[1] ?? 'utf-8').toLowerCase();
  return iconv.encodingExists(cs) ? iconv.decode(buf, cs) : buf.toString('utf8');
}

export async function fetchPage(url: string): Promise<{ html: string; tracker: string }> {
  try { return await fetchOnce(url); }
  catch (e: any) {
    const transient = !(e instanceof FetchError) || /ERR_NAME_NOT_RESOLVED|ECONNRESET|ETIMEDOUT|fetch failed|timeout/i.test(e.message);
    if (!transient || (e.status && e.status < 500)) throw e;
    await new Promise(r => setTimeout(r, 10_000));
    return fetchOnce(url);
  }
}

async function fetchOnce(url: string): Promise<{ html: string; tracker: string }> {
  const t = trackerFor(url);
  if (!t) throw new FetchError(`unknown tracker: ${url}`);
  const s = t.cookieFrom === 'none' ? { cookie: '', userAgent: undefined } : sessionFor(t);
  if (t.cookieFrom !== 'none' && !s?.cookie) throw new FetchError(`${t.id}: no session in Prowlarr`);

  if (t.flaresolverr) {
    const host = new URL(url).hostname.replace(/^www\./, '');
    const cookies = s!.cookie.split(/;\s*/).filter(Boolean).map(c => {
      const i = c.indexOf('='); return { name: c.slice(0, i), value: c.slice(i + 1), domain: '.' + host };
    });
    const r = await fetch(`${config.flaresolverr.url}/v1`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cmd: 'request.get', url, maxTimeout: 60_000, cookies }),
    });
    const j: any = await r.json();
    if (j.status !== 'ok') throw new FetchError(`${t.id}: flaresolverr ${j.message}`);
    if (j.solution.status >= 400) throw new FetchError(`${t.id}: HTTP ${j.solution.status}`, j.solution.status);
    // cf_clearance и User-Agent FlareSolverr — чтобы потом скачать .torrent обычным fetch (бинарь через FlareSolverr не отдать)
    const fsCookies = (j.solution.cookies ?? []).map((c: any) => `${c.name}=${c.value}`).join('; ');
    fsSession.set(host, { cookie: [s!.cookie, fsCookies].filter(Boolean).join('; '), userAgent: j.solution.userAgent });
    return { html: j.solution.response, tracker: t.id };
  }

  const headers: Record<string, string> = { 'User-Agent': s?.userAgent || DEFAULT_UA };
  if (s?.cookie) headers.Cookie = s.cookie;
  const r = await fetch(url, { headers, redirect: 'manual' });
  if (r.status >= 300 && r.status < 400) throw new FetchError(`${t.id}: redirect to ${r.headers.get('location')} (session expired?)`, r.status);
  if (!r.ok) throw new FetchError(`${t.id}: HTTP ${r.status}`, r.status);
  return { html: decode(Buffer.from(await r.arrayBuffer()), r.headers.get('content-type')), tracker: t.id };
}

/** Скачать бинарь (.torrent) с трекера с его сессией. Для трекеров за Cloudflare сначала открыть страницу через fetchPage. */
export async function fetchBinary(url: string, referer?: string): Promise<Buffer> {
  const t = trackerFor(url);
  if (!t) throw new FetchError(`unknown tracker: ${url}`);
  const host = new URL(url).hostname.replace(/^www\./, '');
  const base = t.cookieFrom === 'none' ? { cookie: '', userAgent: undefined } : sessionFor(t);
  const fs = [...fsSession.entries()].find(([h]) => host.endsWith(h) || h.endsWith(host.replace(/^dl\./, '')))?.[1];
  const s = t.flaresolverr && fs ? fs : base;
  const headers: Record<string, string> = { 'User-Agent': s?.userAgent || DEFAULT_UA };
  if (s?.cookie) headers.Cookie = s.cookie;
  if (referer) headers.Referer = referer;
  const r = await fetch(url, { headers, redirect: 'follow' });
  if (!r.ok) throw new FetchError(`${t.id}: HTTP ${r.status} при скачивании .torrent`, r.status);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf[0] !== 0x64) throw new FetchError(`${t.id}: вместо .torrent пришло ${r.headers.get('content-type')} (${buf.subarray(0, 60).toString('utf8').replace(/\s+/g, ' ')})`);
  return buf;
}
