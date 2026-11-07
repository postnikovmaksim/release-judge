/** Классификация аудиодорожек по названию + нормализация языков. Общая для файлов и описаний раздач. */
export type AudioKind = 'dub' | 'mvo' | 'dvo' | 'avo' | 'vo' | 'original' | 'commentary' | 'unknown';

const LANG: Record<string, string> = { russian: 'rus', english: 'eng', ukrainian: 'ukr', japanese: 'jpn', french: 'fre', german: 'ger', kazakh: 'kaz', korean: 'kor', italian: 'ita', spanish: 'spa', chinese: 'chi', русский: 'rus', английский: 'eng', украинский: 'ukr', японский: 'jpn', ru: 'rus', rus: 'rus', uk: 'ukr', ukr: 'ukr', en: 'eng', eng: 'eng', ja: 'jpn', jpn: 'jpn',
  fr: 'fre', fre: 'fre', fra: 'fre', de: 'ger', ger: 'ger', deu: 'ger', kk: 'kaz', kaz: 'kaz', ko: 'kor', kor: 'kor', it: 'ita', ita: 'ita', es: 'spa', spa: 'spa' };
export const normLang = (l?: string) => { if (!l) return 'und'; const k = l.toLowerCase().trim().split(/[\s(,]/)[0]; return LANG[k] ?? k; };

const RULES: [AudioKind, RegExp][] = [
  ['commentary', /коммент|comment|\bdescription\b|descriptive|тифло/i],   // тифлокомментарий (Description) — как комментарий
  ['dub', /дубл|\bdub(bing|bed|l)?\b|=dub|^\s*D(\s|,|$)|полное дублирование/i],
  ['mvo', /многоголос|\bMVO\b|^\s*P(\s|,|$)/i],
  ['dvo', /двухголос|\bDVO\b/i],
  ['avo', /авторск|одноголос|\bAVO\b|^\s*A(\s|,|$)/i],
  ['vo', /\bVO\b|закадров/i],
  ['avo', /^\|?\s*[А-ЯЁ]\.\s?([А-ЯЁ]\.\s?)?[А-ЯЁ][а-яё]+|^\|?(Гаврилов|Володарский|Михал[её]в|Живов|Сербин|Визгунов|Горчаков|Карцев|Гоблин|Пучков|Немахов|Есарев|Яроцкий|Дольский|Кашкин)/],
  ['original', /оригинал|original|\borig\b/i],
];

export function classifyAudio(title: string | undefined, lang: string, originalLang?: string): AudioKind {
  const lead = (title ?? '').replace(/^[\s|,.:;\/-]+/, '').match(/^(dub|mvo|dvo|avo|vo)(?![a-zа-яё])/i)?.[1].toLowerCase();
  if (lead) return lead as AudioKind;
  const t = title ?? '';
  for (const [kind, re] of RULES) {
    if (!re.test(t)) continue;
    // «MVO, Омикрон (разговоры Орков оставлены в оригинале)» — русская дорожка не оригинал, если фильм не русский
    if (kind === 'original' && (lang === 'rus' || lang === 'ukr') && originalLang !== lang) continue;
    return kind;
  }
  if (originalLang && lang === originalLang && lang !== 'rus') return 'original';
  if (lang === 'eng' && !t) return 'original';
  return 'unknown';
}

/** Автор/студия: всё после типа перевода — «Дубляж, West Video» -> «West Video», «AVO Юрий Немахов» -> «Юрий Немахов». */
export function extractAuthor(title?: string): string | undefined {
  if (!title) return undefined;
  const s = title
    .replace(/^перевод\s*:\s*/i, '')
    .replace(/^(профессиональный|авторский|любительский)\s*/i, '')
    .replace(/^\([^)]*\)\s*/, '')
    .replace(/^(russian|rus|ukrainian|ukr|english|eng)\s*[,:-]?\s*/i, '')
    .replace(/^(дубляж|полное дублирование|dub|многоголосый закадровый|двухголосый закадровый|одноголосый закадровый|авторский|закадровый|MVO|DVO|AVO|VO|D|P|A)(?=[\s,.:-]|$)\s*[,.:-]?\s*/i, '')   // «DVO. П.Гланц» — с точкой тоже
    .replace(/\b(blu-?ray|bd|dvd|web|itunes|netflix|custom|cee|eur|usa)\b.*$/i, '')
    .replace(/[\s,|/-]+$/g, '').trim();
  return s || undefined;
}

// Латинские «двойники» кириллических букв — некоторые релизеры (NNM) так обфусцируют названия дорожек
const HOMO: Record<string, string> = {
  a: 'а', b: 'ь', c: 'с', e: 'е', g: 'д', k: 'к', m: 'т', n: 'п', o: 'о', p: 'р', u: 'и', x: 'х', y: 'у', '6': 'б', '3': 'з',
  A: 'А', B: 'В', C: 'С', E: 'Е', H: 'Н', K: 'К', M: 'М', O: 'О', P: 'Р', T: 'Т', X: 'Х', Y: 'У',
};
/** В словах, где смешаны кириллица и латиница, латинские двойники заменяются кириллицей. Чисто латинские слова не трогаем. */
export function normalizeHomoglyphs(s?: string): string | undefined {
  if (!s) return s;
  return s.replace(/[A-Za-zА-Яа-яЁё0-9]+/g, w =>
    /[А-Яа-яЁё]/.test(w) && /[A-Za-z]/.test(w) ? [...w].map(ch => HOMO[ch] ?? ch).join('') : w);
}
