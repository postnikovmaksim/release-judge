/** Трекеры: как найти индексатор в Prowlarr, откуда брать cookie, нужен ли FlareSolverr, как выделить главный пост. */
export interface TrackerDef {
  id: string;                     // TeamHD, RuTracker...
  hosts: RegExp;
  prowlarrName: RegExp;           // имя индексатора в Prowlarr
  cookieFrom: 'settings' | 'status' | 'none';      // none — публичный трекер
  flaresolverr: boolean;
  mainPost: string;               // CSS-селектор главного поста
  mediainfo?: string;             // селектор <pre> c MediaInfo внутри главного поста
}

export const TRACKERS: TrackerDef[] = [
  { id: 'TeamHD', hosts: /(^|\.)teamhd\.org$/i, prowlarrName: /^TeamHD/i, cookieFrom: 'settings', flaresolverr: false,
    mainPost: 'body', mediainfo: '.card:has(.card-header:contains("MediaInfo")) .card-body pre' },
  { id: 'RuTracker', hosts: /(^|\.)rutracker\.(org|net|nl)$/i, prowlarrName: /^RuTracker/i, cookieFrom: 'status', flaresolverr: true,
    mainPost: '.post_body:first', mediainfo: '.sp-wrap:has(.sp-head:contains("MediaInfo")) .sp-body pre' },
  { id: 'Tapochek', hosts: /(^|\.)tapochek\.net$/i, prowlarrName: /^Tapochek/i, cookieFrom: 'status', flaresolverr: false,
    mainPost: '.post_body:first, .post-body:first', mediainfo: '.sp-body[title="MediaInfo"] pre' },
  { id: 'Kinozal', hosts: /(^|\.)kinozal\.(tv|me|guru)$/i, prowlarrName: /^Kinozal/i, cookieFrom: 'status', flaresolverr: true,   // с 2026-11 за Cloudflare (cf_clearance)
    mainPost: '.mn1_content, .content' },
  { id: 'NNM', hosts: /(^|\.)nnmclub\.(to|me)$/i, prowlarrName: /^NoNaMe/i, cookieFrom: 'status', flaresolverr: true,
    mainPost: '.postbody:first', mediainfo: '.spoiler-wrap:has(.spoiler-head:contains("MediaInfo")) .spoiler-body pre' },
  { id: 'RuTor', hosts: /(^|\.)rutor\.(info|is|org)$/i, prowlarrName: /^RuTor/i, cookieFrom: 'none', flaresolverr: false,
    mainPost: '#details', mediainfo: 'textarea.hidearea' },
];

export const trackerFor = (url: string) => TRACKERS.find(t => t.hosts.test(new URL(url).hostname));
