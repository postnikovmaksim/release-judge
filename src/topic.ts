import { createHash } from 'node:crypto';
import { db } from './db.js';
import { fetchPage } from './trackers/fetchPage.js';
import { extract } from './trackers/extract.js';
import { parseMediainfoText } from './spec/mediainfoText.js';
import { specFromMediainfo, enrichAudio, fillFromSummary } from './spec/fromMediainfo.js';
import { descFlags, audioHints, audioSummary } from './spec/descFlags.js';
import type { ReleaseSpec } from './spec/schema.js';

export interface TopicResult { url: string; tracker: string; title: string; parser: 'mediainfo' | 'none'; spec?: ReleaseSpec; flags: ReturnType<typeof descFlags>; cached: boolean; }

const getCached = db.prepare('SELECT * FROM topic WHERE url = ?');
const save = db.prepare(`INSERT INTO topic (url, tracker, html_hash, spec, parser, fetched_at) VALUES (@url, @tracker, @hash, @spec, @parser, CURRENT_TIMESTAMP)
  ON CONFLICT(url) DO UPDATE SET tracker=excluded.tracker, html_hash=excluded.html_hash, spec=excluded.spec, parser=excluded.parser, fetched_at=CURRENT_TIMESTAMP`);

/** Скачать и разобрать страницу раздачи. Кэш — 24 ч (если не force). LLM-фолбэк для описаний без MediaInfo — следующий шаг. */
export async function parseTopic(url: string, opts: { force?: boolean } = {}): Promise<TopicResult> {
  const c = getCached.get(url) as any;
  if (c && !opts.force && c.parser === 'mediainfo' && Date.now() - Date.parse(c.fetched_at + 'Z') < 24 * 3600_000) {   // неудачные разборы не кэшируем
    const p = JSON.parse(c.spec);
    return { ...p, cached: true };
  }
  const { html, tracker } = await fetchPage(url);
  const ex = extract(tracker, html);
  const flags = descFlags(ex.description + '\n' + ex.title);
  let spec: ReleaseSpec | undefined;
  if (ex.mediainfo) {
    spec = specFromMediainfo(parseMediainfoText(ex.mediainfo));
    spec.video.localized = flags.localized;
    spec.video.upscale = flags.upscale;
    if (flags.dvLayer && spec.video.hdr.includes('dv')) spec.video.dvLayer = flags.dvLayer;
    enrichAudio(spec, audioHints(ex.description));
    fillFromSummary(spec, audioSummary(ex.description));
    spec.tracker = tracker; spec.topicUrl = url;
  }
  const result: TopicResult = { url, tracker, title: ex.title, parser: spec ? 'mediainfo' : 'none', spec, flags, cached: false };
  save.run({ url, tracker, hash: createHash('sha1').update(html).digest('hex'), spec: JSON.stringify(result), parser: result.parser });
  return result;
}
