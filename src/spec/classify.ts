/** Классификация аудиодорожек по названию + нормализация языков. Общая для файлов и описаний раздач. */
export type AudioKind = 'dub' | 'mvo' | 'dvo' | 'avo' | 'vo' | 'original' | 'commentary' | 'unknown';

const LANG: Record<string, string> = { ru: 'rus', rus: 'rus', uk: 'ukr', ukr: 'ukr', en: 'eng', eng: 'eng', ja: 'jpn', jpn: 'jpn',
  fr: 'fre', fre: 'fre', fra: 'fre', de: 'ger', ger: 'ger', deu: 'ger', kk: 'kaz', kaz: 'kaz', ko: 'kor', kor: 'kor', it: 'ita', ita: 'ita', es: 'spa', spa: 'spa' };
export const normLang = (l?: string) => (l ? LANG[l.toLowerCase()] ?? l.toLowerCase() : 'und');

const RULES: [AudioKind, RegExp][] = [
  ['commentary', /коммент|comment/i],
  ['dub', /дубл|\bdub(bing|bed)?\b|^\s*D(\s|,|$)|полное дублирование/i],
  ['mvo', /многоголос|\bMVO\b|^\s*P(\s|,|$)/i],
  ['dvo', /двухголос|\bDVO\b/i],
  ['avo', /авторск|одноголос|\bAVO\b|^\s*A(\s|,|$)/i],
  ['vo', /\bVO\b|закадров/i],
  ['avo', /^\|?\s*[А-ЯЁ]\.\s?([А-ЯЁ]\.\s?)?[А-ЯЁ][а-яё]+|^\|?(Гаврилов|Володарский|Михал[её]в|Живов|Сербин|Визгунов|Горчаков|Карцев|Гоблин|Пучков|Немахов|Есарев|Яроцкий|Дольский|Кашкин)/],
  ['original', /оригинал|original|\borig\b/i],
];

export function classifyAudio(title: string | undefined, lang: string, originalLang?: string): AudioKind {
  const t = title ?? '';
  for (const [kind, re] of RULES) if (re.test(t)) return kind;
  if (originalLang && lang === originalLang && lang !== 'rus') return 'original';
  if (lang === 'eng' && !t) return 'original';
  return 'unknown';
}

/** Автор/студия: всё после типа перевода — «Дубляж, West Video» -> «West Video», «AVO Юрий Немахов» -> «Юрий Немахов». */
export function extractAuthor(title?: string): string | undefined {
  if (!title) return undefined;
  const s = title
    .replace(/^(russian|rus|ukrainian|ukr|english|eng)\s*[,:-]?\s*/i, '')
    .replace(/^(дубляж|полное дублирование|dub|многоголосый закадровый|двухголосый закадровый|одноголосый закадровый|авторский|закадровый|MVO|DVO|AVO|VO|D|P|A)(?=[\s,:-]|$)\s*[,:-]?\s*/i, '')
    .replace(/\b(blu-?ray|bd|dvd|web|itunes|netflix|custom|cee|eur|usa)\b.*$/i, '')
    .replace(/[\s,|/-]+$/g, '').trim();
  return s || undefined;
}
