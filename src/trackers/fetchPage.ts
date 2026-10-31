import iconv from 'iconv-lite';
import { config } from '../config.js';
import { trackerFor } from './registry.js';
import { sessionFor } from './prowlarrSession.js';

const DEFAULT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

export class FetchError extends Error { constructor(msg: string, public status?: number) { super(msg); } }

function decode(buf: Buffer, contentType: string | null): string {
  const head = buf.subarray(0, 4096).toString('latin1');
  const cs = (contentType?.match(/charset=([\w-]+)/i)?.[1] ?? head.match(/charset=["']?([\w-]+)/i)?.[1] ?? 'utf-8').toLowerCase();
  return iconv.encodingExists(cs) ? iconv.decode(buf, cs) : buf.toString('utf8');
}

export async function fetchPage(url: string): Promise<{ html: string; tracker: string }> {
  const t = trackerFor(url);
  if (!t) throw new FetchError(`unknown tracker: ${url}`);
  const s = sessionFor(t);
  if (!s?.cookie) throw new FetchError(`${t.id}: no session in Prowlarr`);

  if (t.flaresolverr) {
    const host = new URL(url).hostname.replace(/^www\./, '');
    const cookies = s.cookie.split(/;\s*/).filter(Boolean).map(c => {
      const i = c.indexOf('='); return { name: c.slice(0, i), value: c.slice(i + 1), domain: '.' + host };
    });
    const r = await fetch(`${config.flaresolverr.url}/v1`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cmd: 'request.get', url, maxTimeout: 60_000, cookies }),
    });
    const j: any = await r.json();
    if (j.status !== 'ok') throw new FetchError(`${t.id}: flaresolverr ${j.message}`);
    if (j.solution.status >= 400) throw new FetchError(`${t.id}: HTTP ${j.solution.status}`, j.solution.status);
    return { html: j.solution.response, tracker: t.id };
  }

  const r = await fetch(url, { headers: { Cookie: s.cookie, 'User-Agent': s.userAgent || DEFAULT_UA }, redirect: 'manual' });
  if (r.status >= 300 && r.status < 400) throw new FetchError(`${t.id}: redirect to ${r.headers.get('location')} (session expired?)`, r.status);
  if (!r.ok) throw new FetchError(`${t.id}: HTTP ${r.status}`, r.status);
  return { html: decode(Buffer.from(await r.arrayBuffer()), r.headers.get('content-type')), tracker: t.id };
}
