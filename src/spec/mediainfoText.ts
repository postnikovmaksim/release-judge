/**
 * Парсер текстового вывода MediaInfo (как его вставляют в описания раздач) в треки
 * с теми же ключами, что у `mediainfo --Output=JSON` — чтобы переиспользовать specFromMediainfo.
 */
type Track = Record<string, string | undefined>;

const SECTION = /^(General|Video|Audio|Text|Menu|Image|Other)(\s*#\s*(\d+))?\s*$/i;
const KV = /^([^:]{1,60}?)\s+:\s?(.*)$/;

const KEYMAP: Record<string, string> = {
  'format': 'Format', 'format/info': 'Format_Info', 'commercial name': 'Format_Commercial_IfAny',
  'format profile': 'Format_Profile', 'additional features': 'Format_AdditionalFeatures',
  'hdr format': 'HDR_Format_Full', 'language': 'Language', 'title': 'Title', 'channel(s)': 'Channels',
  'bit rate': 'BitRate', 'compression mode': 'Compression_Mode', 'forced': 'Forced', 'default': 'Default',
  'transfer characteristics': 'transfer_characteristics', 'width': 'Width', 'height': 'Height', 'file size': 'FileSize', 'complete name': 'CompleteName',
  'movie name': 'Title', 'unique id': 'UniqueID', 'duration': 'Duration', 'frame rate': 'FrameRate', 'bit depth': 'BitDepth',
};

const num = (s?: string) => (s ? Number(s.replace(/[^\d.]/g, '')) : NaN);
function bitrate(v: string): string | undefined {
  const m = v.replace(/\s/g, '').match(/([\d.]+)(k|M)b\/s/i);
  if (!m) return undefined;
  return String(Math.round(+m[1] * (m[2].toLowerCase() === 'm' ? 1e6 : 1e3)));
}
function filesize(v: string): string | undefined {
  const m = v.replace(/\s/g, '').match(/([\d.]+)(GiB|MiB|TiB|GB|MB)/i);
  if (!m) return undefined;
  const mul: Record<string, number> = { gib: 2 ** 30, mib: 2 ** 20, tib: 2 ** 40, gb: 1e9, mb: 1e6 };
  return String(Math.round(+m[1] * mul[m[2].toLowerCase()]));
}

export function parseMediainfoText(text: string): Track[] {
  const tracks: Track[] = [];
  let cur: Track | null = null;
  for (const raw of text.replace(/\r/g, '\n').split('\n')) {
    const line = raw.replace(/ /g, ' ').trim();
    if (!line) continue;
    const s = line.match(SECTION);
    if (s) { cur = { '@type': s[1][0].toUpperCase() + s[1].slice(1).toLowerCase() }; tracks.push(cur); continue; }
    const kv = line.match(KV);
    if (!kv) continue;
    if (!cur) { cur = { '@type': 'General' }; tracks.push(cur); }   // дамп без заголовка General (Tapochek)
    const key = KEYMAP[kv[1].trim().toLowerCase()];
    if (!key || cur[key] !== undefined) continue;          // первое значение (BitRate vs BitRate maximum и т.п.)
    let v = kv[2].trim();
    if (key === 'BitRate') v = bitrate(v) ?? v;
    else if (key === 'FileSize') v = filesize(v) ?? v;
    else if (key === 'Channels') v = String(num(v.split('/')[0]));
    else if (key === 'Width' || key === 'Height') v = String(num(v));
    cur[key] = v;
  }
  // HDR format: "Dolby Vision, Version 1.0, Profile 7.6, dvhe.07.06, BL+EL+RPU, ... / SMPTE ST 2086, HDR10 compatible"
  for (const t of tracks) {
    const h = t.HDR_Format_Full;
    if (!h) continue;
    t.HDR_Format = h;
    const p = h.match(/Profile\s+(\d+)(?:\.(\d+))?|dvhe\.0?(\d)\.(\d+)/i);
    if (p) t.HDR_Format_Profile = `dvhe.0${p[1] ?? p[3]}.${p[2] ?? p[4] ?? '06'}`;
    const set = h.match(/(BL\+EL\+RPU|BL\+RPU)/i);
    if (set) t.HDR_Format_Settings = set[1];
  }
  return tracks;
}

/** Есть ли в тексте похоже на MediaInfo-дамп (а не краткую сводку). */
export const looksLikeMediainfo = (t: string) =>
  /^\s*Video(\s*#\s*\d+)?\s*$/m.test(t) && /^\s*Audio(\s*#\s*\d+)?\s*$/m.test(t) && /^\s*Format\s+:/m.test(t);
