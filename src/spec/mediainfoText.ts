/**
 * Парсер текстового вывода MediaInfo (как его вставляют в описания раздач) в треки
 * с теми же ключами, что у `mediainfo --Output=JSON` — чтобы переиспользовать specFromMediainfo.
 * Понимает английскую и русскую локализацию MediaInfo (NNM-Club выкладывает русскую).
 */
type Track = Record<string, string | undefined>;

const SECTION_NAMES: Record<string, string> = {
  general: 'General', video: 'Video', audio: 'Audio', text: 'Text', menu: 'Menu', image: 'Image', other: 'Other',
  'общее': 'General', 'видео': 'Video', 'аудио': 'Audio', 'текст': 'Text', 'меню': 'Menu', 'изображение': 'Image',
};
const SECTION = /^(General|Video|Audio|Text|Menu|Image|Other|Общее|Видео|Аудио|Текст|Меню|Изображение)(\s*#\s*(\d+))?\s*:?\s*$/i;
const KV = /^([^:]{1,60}?)\s+:\s?(.*)$/;

const KEYMAP: Record<string, string> = {
  'format': 'Format', 'format/info': 'Format_Info', 'commercial name': 'Format_Commercial_IfAny',
  'format profile': 'Format_Profile', 'additional features': 'Format_AdditionalFeatures',
  'hdr format': 'HDR_Format_Full', 'language': 'Language', 'title': 'Title', 'channel(s)': 'Channels',
  'bit rate': 'BitRate', 'compression mode': 'Compression_Mode', 'forced': 'Forced', 'default': 'Default',
  'transfer characteristics': 'transfer_characteristics', 'width': 'Width', 'height': 'Height', 'file size': 'FileSize',
  'complete name': 'CompleteName', 'movie name': 'Title', 'unique id': 'UniqueID', 'duration': 'Duration',
  'frame rate': 'FrameRate', 'bit depth': 'BitDepth',
  // русская локализация MediaInfo
  'формат': 'Format', 'формат/информация': 'Format_Info', 'коммерческое название': 'Format_Commercial_IfAny',
  'профиль формата': 'Format_Profile', 'дополнительные параметры': 'Format_AdditionalFeatures', 'дополнительные функции': 'Format_AdditionalFeatures',
  'формат hdr': 'HDR_Format_Full', 'язык': 'Language', 'заголовок': 'Title', 'каналы': 'Channels', 'канал(ы)': 'Channels',
  'битрейт': 'BitRate', 'метод сжатия': 'Compression_Mode', 'режим сжатия': 'Compression_Mode', 'принудительно': 'Forced',
  'по умолчанию': 'Default', 'характеристики трансфера': 'transfer_characteristics', 'характеристики передачи': 'transfer_characteristics',
  'ширина': 'Width', 'высота': 'Height', 'размер файла': 'FileSize', 'полное имя': 'CompleteName',
  'уникальный идентификатор': 'UniqueID', 'продолжительность': 'Duration', 'частота кадров': 'FrameRate', 'битовая глубина': 'BitDepth',
};

const num = (s?: string) => (s ? Number(s.replace(/\s/g, '').replace(',', '.').replace(/[^\d.]/g, '')) : NaN);
function bitrate(v: string): string | undefined {
  const m = v.replace(/\s/g, '').replace(',', '.').match(/([\d.]+)(k|M|К|М)(b|бит)/i);
  if (!m) return undefined;
  return String(Math.round(+m[1] * (/^[mм]$/i.test(m[2]) ? 1e6 : 1e3)));
}
function filesize(v: string): string | undefined {
  const m = v.replace(/\s/g, '').replace(',', '.').match(/([\d.]+)(GiB|MiB|TiB|GB|MB|ГиБ|МиБ|Гбайт|Мбайт|ТиБ|Тбайт)/i);
  if (!m) return undefined;
  const u = m[2].toLowerCase();
  const mul = /^t|^т/.test(u) ? 2 ** 40 : /^g|^г/.test(u) ? 2 ** 30 : 2 ** 20;
  return String(Math.round(+m[1] * mul));
}
const yesNo = (v: string) => (/^(да|yes)$/i.test(v.trim()) ? 'Yes' : /^(нет|no)$/i.test(v.trim()) ? 'No' : v);
const compression = (v: string) => (/без потерь|lossless/i.test(v) ? 'Lossless' : /с потерями|lossy/i.test(v) ? 'Lossy' : v);

export function parseMediainfoText(text: string): Track[] {
  const tracks: Track[] = [];
  let cur: Track | null = null;
  for (const raw of text.replace(/<br\s*\/?>/gi, '\n').replace(/\r/g, '\n').split('\n')) {
    const line = raw.replace(/\u00a0/g, ' ').trim();
    if (!line) continue;
    const s = line.match(SECTION);
    if (s) { cur = { '@type': SECTION_NAMES[s[1].toLowerCase()] }; tracks.push(cur); continue; }
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
    else if (key === 'Forced' || key === 'Default') v = yesNo(v);
    else if (key === 'Compression_Mode') v = compression(v);
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

/** Похоже ли на MediaInfo-дамп (а не краткую сводку). */
export const looksLikeMediainfo = (t: string) => {
  const s = t.replace(/<br\s*\/?>/gi, '\n');
  return /^\s*(Video|Видео)(\s*#\s*\d+)?\s*:?\s*$/m.test(s) && /^\s*(Audio|Аудио)(\s*#\s*\d+)?\s*:?\s*$/m.test(s) && /^\s*(Format|Формат)\s+:/m.test(s);
};
