/** Флаги, которые есть только в свободном описании раздачи (в MediaInfo их нет). */
export interface DescFlags { dvLayer?: 'FEL' | 'MEL'; localized: boolean; upscale: boolean; hybrid: boolean; }

export function descFlags(desc: string): DescFlags {
  return {
    dvLayer: /\bFEL\b/.test(desc) ? 'FEL' : /\bMEL\b/.test(desc) ? 'MEL' : undefined,
    localized: /локализованн[а-яё]*\s+(видеоряд|титр|надпис)/i.test(desc),
    upscale: /\bupscal|апскейл|\bAI[ ._-]?upscale/i.test(desc),
    hybrid: /\bhybrid\b|гибрид/i.test(desc),
  };
}

/**
 * Подсказки по аудиодорожкам из краткой сводки описания:
 *   RuTracker: «Аудио 1: Русский, DTS, 5.1, ... / Dub Пифагор»
 *   TeamHD:    «Аудио#1: Russian: 48 kHz/24-bit, DTS 5.1 ... |Дубляж, West Video|»
 * Возвращает index (1-based) -> строка-подсказка (то, что после "/" или между "|").
 */
export function audioHints(desc: string): Map<number, string> {
  const m = new Map<number, string>();
  for (const line of desc.split('\n')) {
    const a = line.match(/^\s*(?:Аудио|Audio)\s*#?\s*(\d+)\s*:(.*)$/i);
    if (!a) continue;
    const rest = a[2];
    const hint = rest.match(/\|([^|]+)\|/)?.[1] ?? (rest.includes(' / ') ? rest.slice(rest.lastIndexOf(' / ') + 3) : undefined);
    if (hint?.trim()) m.set(+a[1], hint.trim());
  }
  return m;
}
