import { createHash } from 'node:crypto';
import { db } from './db.js';
import { fetchPage } from './trackers/fetchPage.js';
import { extract, textFromHtml } from './trackers/extract.js';
import { looksLikeMediainfo } from './spec/mediainfoText.js';
import { parseMediainfoText } from './spec/mediainfoText.js';
import { parseBdinfo } from './spec/bdinfo.js';
import { specFromSummary, kinozalAudioLines } from './spec/summaryOnly.js';
import { specFromMediainfo, enrichAudio, fillFromSummary, applyTitleDub } from './spec/fromMediainfo.js';
import { descFlags, audioHints, audioSummary, titleClaimsDub } from './spec/descFlags.js';
import type { ReleaseSpec } from './spec/schema.js';
import { isDiscLayout, mayBeDisc } from './spec/container.js';
import { fetchNewTorrent } from './refresh/run.js';

export interface TopicResult { url: string; tracker: string; title: string; parser: 'mediainfo' | 'bdinfo' | 'summary' | 'none'; spec?: ReleaseSpec; flags: ReturnType<typeof descFlags>; cached: boolean; }

const getCached = db.prepare('SELECT * FROM topic WHERE url = ?');
const save = db.prepare(`INSERT INTO topic (url, tracker, html_hash, spec, parser, fetched_at) VALUES (@url, @tracker, @hash, @spec, @parser, CURRENT_TIMESTAMP)
  ON CONFLICT(url) DO UPDATE SET tracker=excluded.tracker, html_hash=excluded.html_hash, spec=excluded.spec, parser=excluded.parser, fetched_at=CURRENT_TIMESTAMP`);

/** Скачать и разобрать страницу раздачи. Кэш — 24 ч (если не force). LLM-фолбэк для описаний без MediaInfo — следующий шаг. */
export async function parseTopic(url: string, opts: { force?: boolean } = {}): Promise<TopicResult> {
  const c = getCached.get(url) as any;
  if (c && !opts.force && c.parser !== 'none' && Date.now() - Date.parse(c.fetched_at + 'Z') < 24 * 3600_000) {   // неудачные разборы не кэшируем
    const p = JSON.parse(c.spec);
    return { ...p, cached: true };
  }
  const { html, tracker } = await fetchPage(url);
  const ex = extract(tracker, html);
  if (tracker === 'Kinozal') await kinozalReleaseTab(url, html, ex);
  const flags = descFlags(ex.description + '\n' + ex.title);
  let spec: ReleaseSpec | undefined;
  const tracks = ex.mediainfo ? parseMediainfoText(ex.mediainfo) : ex.bdinfo ? parseBdinfo(ex.bdinfo) : undefined;
  if (!tracks) spec = specFromSummary(ex.title, ex.description);
  if (tracks) {
    spec = specFromMediainfo(tracks);
    spec.video.localized = flags.localized;
    spec.video.upscale = flags.upscale;
    if (flags.dvLayer && spec.video.hdr.includes('dv')) spec.video.dvLayer = flags.dvLayer;
    enrichAudio(spec, audioHints(ex.description));
    fillFromSummary(spec, audioSummary(ex.description));
    applyTitleDub(spec, titleClaimsDub(ex.title));
    spec.tracker = tracker; spec.topicUrl = url;
  }
  if (spec && !tracks) { spec.tracker = tracker; spec.topicUrl = url; spec.video.localized = flags.localized; spec.video.upscale = flags.upscale; }
  // признаки диска на странице — проверяем список файлов в .torrent (BDMV → как BR-DISK)
  if (spec && mayBeDisc(html, !!ex.bdinfo)) {
    try { const n = await fetchNewTorrent({ topicUrl: url, tracker }); if (n.meta) spec.container = isDiscLayout(n.meta.files.map(f => f.path)) ? 'bdmv' : 'mkv'; } catch { /* .torrent недоступен — не знаем */ }
  }
  const parser = ex.mediainfo ? 'mediainfo' : ex.bdinfo ? 'bdinfo' : spec ? 'summary' : 'none';
  const result: TopicResult = { url, tracker, title: ex.title, parser: spec ? parser as any : 'none', spec, flags, cached: false };
  save.run({ url, tracker, hash: createHash('sha1').update(html).digest('hex'), spec: JSON.stringify(result), parser: result.parser });
  return result;
}

/** Kinozal: на странице только «Техданные»-сводка, вкладка «Релиз» (дорожки «Аудио N: … - MVO …», иногда MediaInfo) грузится AJAX-ом. */
async function kinozalReleaseTab(url: string, page: string, ex: { description: string; mediainfo?: string }) {
  const u = new URL(url); const id = u.searchParams.get('id');
  if (!id) return;
  try {
    const { html } = await fetchPage(`${u.origin}/get_srv_details.php?id=${id}&pagesd=0`);
    const tx = textFromHtml(html);
    if (!ex.mediainfo && looksLikeMediainfo(tx)) ex.mediainfo = tx;
    else {
      // нет нумерованных «Аудио N:» во вкладке — собираем их из сводки страницы
      const extra = /^\s*(?:Аудио|Audio)\s*#?\s*\d+\s*:/im.test(tx) ? '' : kinozalAudioLines(textFromHtml(page), tx);
      ex.description = (extra + '\n' + ex.description + '\n' + tx).slice(0, 20_000);
    }
  } catch { /* вкладка не обязательна */ }
}
