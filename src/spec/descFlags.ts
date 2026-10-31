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
 * Строки краткой сводки об аудио:
 *   RuTracker: «Аудио 1: Русский, DTS, 5.1, ... / Dub Пифагор»
 *   TeamHD:    «Аудио#1: Russian: 48 kHz/24-bit, DTS 5.1 ... |Дубляж, West Video|»
 *   Tapochek:  «Аудио #1: | AC3 / 5.1 / 48 kHz / 448 kbps | Dub, MovieDalen»
 *   RuTor:     «Аудио 1: Русский 48 kHz, AC3, 6 ch 448 Kbps - Дубляж»
 */
export interface AudioLine { line: string; hint?: string; }
export function audioSummary(desc: string): Map<number, AudioLine> {
  const m = new Map<number, AudioLine>();
  for (const line of desc.split('\n')) {
    const a = line.match(/^\s*(?:Аудио|Audio)\s*#?\s*(\d+)\s*:(.*)$/i);
    if (!a) continue;
    const rest = a[2];
    const pipes = rest.split('|').map(s => s.trim()).filter(Boolean);
    const hint = rest.includes('|') ? pipes[pipes.length - 1]
      : rest.includes(' / ') ? rest.slice(rest.lastIndexOf(' / ') + 3)
      : rest.includes(' - ') ? rest.slice(rest.lastIndexOf(' - ') + 3) : undefined;
    m.set(+a[1], { line: rest.trim(), hint: hint?.trim() || undefined });
  }
  return m;
}
export function audioHints(desc: string): Map<number, string> {
  const m = new Map<number, string>();
  for (const [k, v] of audioSummary(desc)) if (v.hint) m.set(k, v.hint);
  return m;
}


/** Заявлен ли дубляж в названии раздачи: «Dub + 2x MVO», «Дубляж», RuTor «| D, P2, A». */
export const titleClaimsDub = (title: string) =>
  /\bDub\b|дубляж|дублир|[|,]\s*D\s*(?:[,|]|$)/i.test(title);
