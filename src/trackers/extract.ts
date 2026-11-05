import * as cheerio from 'cheerio';
import { looksLikeMediainfo } from '../spec/mediainfoText.js';
import { looksLikeBdinfo } from '../spec/bdinfo.js';
import { TRACKERS } from './registry.js';

/** Текст элемента с переводами строк вместо <br>/<p>/<div>. */
function textOf($: cheerio.CheerioAPI, el: cheerio.Cheerio<any>): string {
  const c = el.clone();
  c.find('br').replaceWith('\n');
  c.find('p, div, li, tr, pre, h1, h2, h3, h4').each((_, e) => { $(e).append('\n'); });
  return c.text().replace(/\r/g, '\n').replace(/[ \t ]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
}

export interface Extracted { title: string; description: string; mediainfo?: string; bdinfo?: string; }

export function extract(trackerId: string, html: string): Extracted {
  const $ = cheerio.load(html);
  const t = TRACKERS.find(x => x.id === trackerId)!;
  const title = $('title').first().text().trim();
  let main = $(t.mainPost).first();
  if (!main.length) main = $('body');

  // 1) MediaInfo по селектору трекера, 2) любой <pre>/спойлер c дампом
  let mediainfo: string | undefined;
  if (t.mediainfo) {
    const pre = main.find(t.mediainfo).first();
    if (pre.length) mediainfo = textOf($, pre);
  }
  if (!mediainfo) {
    main.find('pre, .sp-body, .card-body, .spoiler-body').each((_, e) => {
      const tx = textOf($, $(e));
      if (!mediainfo && looksLikeMediainfo(tx)) mediainfo = tx;
    });
  }
  let bdinfo: string | undefined;
  if (!mediainfo) main.find("pre, .sp-body, .card-body, .spoiler-body").each((_, e) => {
    const tx = textOf($, $(e));
    if (!bdinfo && looksLikeBdinfo(tx)) bdinfo = tx;
  });
  // Описание: главный пост без спойлеров (там MediaInfo, скриншоты, прочие версии)
  const descEl = main.clone();
  descEl.find('.sp-wrap, .card, pre, script, style, .spoiler-wrap').remove();
  let description = textOf($, descEl);
  if (trackerId === 'TeamHD') {
    // на странице TeamHD ниже идёт список других раздач фильма — режем по нему
    const cut = description.search(/\n\d{2}-\d{2}-\d{4} \d{2}:\d{2}Формат:/);
    if (cut > 0) description = description.slice(0, cut);
  }
  return { title, description: description.slice(0, 20_000), mediainfo, bdinfo };
}

/** Текст произвольного HTML-фрагмента (AJAX-вкладки). */
export function textFromHtml(html: string): string { const $ = cheerio.load(html); return textOf($, $('body')); }
