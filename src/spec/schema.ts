import { z } from 'zod';

/** Нормализованное описание релиза или файла на диске — общая схема для сравнения. */
export const AudioTrack = z.object({
  lang: z.string(),                                   // ISO-639-2: rus, eng, ukr...
  kind: z.enum(['dub', 'mvo', 'dvo', 'avo', 'vo', 'original', 'commentary', 'unknown']),
  author: z.string().optional(),                      // «Пифагор», «Ю. Немахов», «Гоблин»
  codec: z.string().optional(),                       // DTS, DTS-HD MA, TrueHD, AC3, EAC3...
  lossless: z.boolean().optional(),
  atmos: z.boolean().optional(),
  channels: z.number().optional(),                    // 2, 6, 8
  bitrateKbps: z.number().optional(),
  title: z.string().optional(),                       // сырое название дорожки
});

export const Subtitle = z.object({
  lang: z.string(),
  kind: z.enum(['full', 'forced', 'sdh', 'commentary', 'unknown']).default('unknown'),
  format: z.string().optional(),                      // SRT, PGS, ASS
});

export const ReleaseSpec = z.object({
  video: z.object({
    width: z.number().optional(),
    height: z.number().optional(),
    codec: z.string().optional(),
    hdr: z.array(z.enum(['hdr10', 'hdr10plus', 'dv', 'hlg'])).default([]),
    dvProfile: z.number().optional(),                 // 5, 7, 8
    dvLayer: z.enum(['FEL', 'MEL']).optional(),
    bitrateKbps: z.number().optional(),
    localized: z.boolean().default(false),            // «Локализованный видеоряд»
    upscale: z.boolean().default(false),
    source: z.string().optional(),                    // «UHD BD Lionsgate 2018»
  }),
  audio: z.array(AudioTrack),
  subs: z.array(Subtitle).default([]),
  uniqueId: z.string().optional(),                    // MediaInfo General Unique ID — совпадает у файла и дампа той же раздачи
  edition: z.string().optional(),
  container: z.enum(['mkv', 'bdmv']).optional(),       // по списку файлов .torrent: BDMV/…/*.m2ts — структура диска
  sizeBytes: z.number().optional(),
  durationSec: z.number().optional(),                 // длительность фильма — главный признак редакции
  tracker: z.string().optional(),
  topicUrl: z.string().optional(),
  confidence: z.number().min(0).max(1).default(1),    // уверенность парсера (LLM < 1)
});
export type ReleaseSpec = z.infer<typeof ReleaseSpec>;
