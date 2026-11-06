/**
 * Договорённости с Максимом — каждый тест = живой пример из разбора карточек.
 * Если тест здесь падает после правки логики — это нарушение принятого решения, а не «устаревший тест».
 * Формат имени: [дата решения] фильм: ожидание — правило.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import YAML from 'yaml';
import { judge, type Ctx } from './compare.js';
import { classifyAudio } from '../spec/classify.js';
import type { ReleaseSpec } from '../spec/schema.js';

const rules = YAML.parse(readFileSync(new URL('../../config/rules.example.yaml', import.meta.url), 'utf8'));
type A = { lang?: string; kind: string; author?: string; title?: string; codec?: string; lossless?: boolean; channels?: number };
let uid = 0;
/** Конструктор спецификации: видео + русские дорожки + английский TrueHD Atmos по умолчанию. */
function spec(video: Partial<ReleaseSpec['video']>, rus: A[], extra: Partial<ReleaseSpec> = {}): ReleaseSpec {
  return {
    video: { hdr: ['hdr10'], height: 2160, width: 3840, localized: false, upscale: false, ...video },
    audio: [...rus.map(a => ({ lang: 'rus', channels: 6, codec: 'AC3', title: `${a.kind} ${a.author ?? ''}`, ...a })),
      { lang: 'eng', kind: 'original', codec: 'TrueHD', lossless: true, atmos: true, channels: 8 }],
    subs: [{ lang: 'rus', kind: 'full' }], confidence: 1, uniqueId: `u${++uid}`, ...extra,
  } as ReleaseSpec;
}
const v = (cur: ReleaseSpec, cand: ReleaseSpec, ctx: Ctx = {}) => judge(cur, cand, rules, ctx);
const DV8 = { hdr: ['dv', 'hdr10'] as any, dvProfile: 8 }, DV7FEL = { hdr: ['dv', 'hdr10'] as any, dvProfile: 7, dvLayer: 'FEL' as const };
const dub = (author = 'Пифагор', codec = 'AC3', lossless = false): A => ({ kind: 'dub', author, codec, lossless, title: `Dub ${author}` });

// ---------- 2026-10-31 ----------
test('[10-31] Сумерки: файл RT (DV) ← TeamHD (HDR10): KEEP — видео решает раньше трекера', () => {
  assert.equal(v(spec(DV7FEL, [dub()]), spec({}, [dub()]), { candidateTracker: 'TeamHD' }).verdict, 'KEEP');
});
test('[10-31] Сумерки: та же раздача (Unique ID совпадает): KEEP «тот же релиз»', () => {
  const s = spec(DV7FEL, [dub()]);
  assert.match(v(s, { ...s }).reasons[0], /тот же релиз/);
});
test('[10-31] трекер — только тай-брейк: при равенстве TeamHD лучше, его «потеря» апгрейд не блокирует', () => {
  assert.equal(v(spec({}, [dub()]), spec({}, [dub()]), { candidateTracker: 'TeamHD' }).verdict, 'UPGRADE');
  assert.equal(v(spec({}, [dub()]), spec(DV8, [dub()]), { currentTracker: 'TeamHD', candidateTracker: 'RuTracker' }).verdict, 'UPGRADE');
});
test('[10-31] BR-DISK / DV5 без HDR10 / апскейл — не предлагать', () => {
  assert.equal(v(spec({}, [dub()]), spec({ hdr: ['dv'], dvProfile: 5 }, [dub()])).verdict, 'REJECT');
  assert.equal(v(spec({}, [dub()]), spec({ ...DV8, upscale: true }, [dub()])).verdict, 'REJECT');
});
test('[10-31] авторские/закадровые не сравниваются (кроме культовых)', () => {
  const cur = spec({}, [dub(), { kind: 'avo', author: 'Ю. Живов' }]);
  assert.equal(v(cur, spec({}, [dub()])).verdict, 'KEEP');
});

// ---------- 2026-11-05 ----------
test('[11-05] Звёздные войны VIII: DV P8 ← DV P7 FEL: KEEP — P7 = P8', () => {
  assert.equal(v(spec(DV8, [dub()]), spec(DV7FEL, [dub()])).verdict, 'KEEP');
});
test('[11-05] HDR10+ поверх DV — плюс', () => {
  assert.equal(v(spec(DV8, [dub()]), spec({ hdr: ['dv', 'hdr10plus', 'hdr10'], dvProfile: 7 }, [dub()])).verdict, 'UPGRADE');
});
test('[11-05] Две крепости: файл Extended ← Theatrical: REJECT — короче не предлагать', () => {
  const j = v(spec({}, []), spec({}, [dub()]), { currentEditionText: 'Two Towers Extended Edition', candidateEditionText: '[Theatrical Cut]' });
  assert.equal(j.verdict, 'REJECT');
});
test('[11-05] Братство кольца: обычная ← Extended: REVIEW — длиннее всегда на проверку, даже при худшем видео', () => {
  const j = v(spec(DV8, [dub()]), spec({}, [dub()]), { currentEditionText: 'Fellowship', candidateEditionText: 'Fellowship [Extended Edition]' });
  assert.equal(j.verdict, 'REVIEW');
  assert.ok(j.why?.some(w => /редакция/.test(w)));
});
test('[11-05] Царство небесное: Director\'s в названии текущей раздачи TeamHD = Director\'s кандидата → редакции равны', () => {
  const j = v(spec(DV8, [dub()]), spec(DV8, [dub()]),
    { currentEditionText: 'Kingdom.of.Heaven.2005.Remux-2160p.mkv Царство небесное (2005) Director\'s Cut Blu-Ray UHD', candidateEditionText: '[Director\'s Cut]', currentTracker: 'TeamHD', candidateTracker: 'Tapochek' });
  assert.equal(j.verdict, 'KEEP');
});
test('[11-05] Братство кольца: дубляж lossless → lossy: только REVIEW, никогда UPGRADE', () => {
  const j = v(spec(DV8, [dub('Мосфильм', 'DTS-HD MA', true)]), spec({ ...DV8, hdr: ['dv', 'hdr10plus', 'hdr10'] }, [dub('Мосфильм', 'AC3')]));
  assert.equal(j.verdict, 'REVIEW');
  assert.ok(j.check?.some(c => /lossless → lossy/.test(c)));
});
test('[11-05] смена студии дубляжа при выигрыше — REVIEW', () => {
  const j = v(spec({}, [dub('Невафильм')]), spec(DV8, [dub('Пифагор')]));
  assert.equal(j.verdict, 'REVIEW');
  assert.ok(j.check?.some(c => /студия/.test(c)));
});
test('[11-05] Конклав: у кандидата студия не подписана — это не «другая студия»; флаги без выигрыша → KEEP', () => {
  assert.equal(v(spec({}, [dub('Пифагор', 'EAC3')]), spec({}, [dub(undefined as any, 'AC3'), { kind: 'dub', codec: 'EAC3', title: 'RUS' }])).verdict, 'KEEP');
});
test('[11-05] Пятый элемент: пропадает Гоблин — REVIEW (пока не REJECT)', () => {
  const cur = spec({}, [dub(), { kind: 'avo', author: 'Гоблин', title: 'AVO Гоблин' }]);
  const j = v(cur, spec(DV8, [dub()]), { year: 1997 });
  assert.equal(j.verdict, 'REVIEW');
  assert.ok(j.check?.some(c => /Гоблин/.test(c)));
});
test('[11-05] Твоё имя: RUS(ext) — минус, но не отказ: REVIEW с пометкой', () => {
  const cand = spec(DV8, []); cand.audio = cand.audio.filter(a => a.lang !== 'rus');
  const j = v(spec({}, [dub()]), cand, { candidateTitle: 'Kimi no Na wa. [RUS(ext),JAP] [2016, BDRemux, HDR10]' });
  assert.equal(j.verdict, 'REVIEW');
  assert.ok(j.check?.some(c => /внешняя/.test(c)));
});
test('[11-05] Джентльмены удачи: русский фильм — оригинал это русская дорожка, дубляж не сравнивается', () => {
  const mk = (codec: string, lossless = false) => spec({ hdr: [], height: 1080, width: 1920 }, [{ kind: 'unknown', codec, lossless, title: 'Russian' }],
    { subs: [] });
  mk('x'); const cur = mk('FLAC', true), cand = mk('AAC'); cand.audio = cand.audio.filter(a => a.lang === 'rus'); cur.audio = cur.audio.filter(a => a.lang === 'rus');
  assert.equal(v(cur, cand, { originalLang: 'rus' }).verdict, 'KEEP');
});
test('[11-05] Тайное окно: неподписанная русская дорожка ≠ «нет дубляжа»', () => {
  assert.equal(v(spec({}, [{ kind: 'unknown', title: 'Russian Dolby Digital 5.1' }]), spec({}, [dub()])).verdict, 'KEEP');
});
test('[11-05] Красавчик: метка =Dubl= — это дубляж', () => {
  assert.equal(classifyAudio('DTS 5.1 768 fps =Dubl=', 'rus', 'ger'), 'dub');
});
test('[11-05] дубляж заявлен в названии раздачи, дорожка подписана студией — не отказ', () => {
  const cand = spec(DV8, [{ kind: 'unknown', title: '|Невафильм_1998г|' }]);
  assert.notEqual(v(spec({}, [dub()]), cand, { candidateTitle: 'Hercules [1997, BDRemux] Dub + 2x MVO' }).verdict, 'REJECT');
});
test('[11-05] Форрест Гамп: у раздачи правда только MVO/AVO — REJECT', () => {
  assert.equal(v(spec({}, [dub()]), spec(DV8, [{ kind: 'mvo', author: 'Тайкун' }, { kind: 'avo', author: 'Гаврилов' }])).verdict, 'REJECT');
});
test('[11-05] Индиана Джонс: «Dub, Licence» у кандидата = официальная MVO «UHD-BD» у файла — не выигрыш', () => {
  const cur = spec({}, [{ kind: 'mvo', author: 'UHD', title: 'Многоголосый закадровый, UHD-BD', codec: 'DTS-HD MA', lossless: true, channels: 2 }]);
  const cand = spec({}, [{ kind: 'dub', author: 'Licence', title: 'Dub, Licence', codec: 'AC3', channels: 2 }]);
  assert.equal(v(cur, cand).verdict, 'KEEP');
});
test('[11-05] Серенити: lossless-дубляж из любительской сборки (Custom/RUSATMOS) + официальный Amazon EAC3 → R5 AC3: REVIEW с обеими пометками', () => {
  const cur = spec({}, [{ kind: 'dub', author: 'Amazon', title: 'Dub, Amazon', codec: 'EAC3' }]);
  const cand = spec({}, [
    { kind: 'dub', author: 'R5', title: 'DUB - R5', codec: 'AC3' },
    { kind: 'dub', author: 'ATMOS)', title: 'DUB - Custom/RUSATMOS', codec: 'DTS-HD MA', lossless: true, channels: 8 },
  ]);
  const j = v(cur, cand);
  assert.equal(j.verdict, 'REVIEW');
  assert.ok(j.why?.some(w => /дубляж/.test(w)), 'выигрыш по дубляжу виден в «Почему»');
  assert.ok(j.check?.some(c => /любительской сборки/.test(c)), 'пометка про Custom');
  assert.ok(j.check?.some(c => /официальный дубляж хуже/.test(c)), 'пометка про официальную дорожку');
  assert.ok(!j.check?.some(c => /студия/.test(c)), 'Amazon/R5/ATMOS — не студии');
});
test('[11-05] Звёздные врата: в файле нет дубляжа, у кандидата есть (ТВ-3) — UPGRADE по правилам (решаешь кнопкой «Игнор»)', () => {
  assert.equal(v(spec({ hdr: [], height: 1080, width: 1920 }, [{ kind: 'avo', author: 'Живов' }]),
    spec({ hdr: [], height: 1080, width: 1920 }, [dub('ТВ-3 (Zone Vision 2019)', 'AC3'), { kind: 'avo', author: 'Живов' }])).verdict, 'UPGRADE');
});
test('[11-05] раздача без MediaInfo (разбор по краткому описанию) — никогда не UPGRADE, только REVIEW с пометкой', () => {
  const cand = spec({ ...DV8, hdr: ['dv', 'hdr10plus', 'hdr10'] }, [dub()], { confidence: 0.5 } as any);
  const j = v(spec({}, [dub()]), cand);
  assert.equal(j.verdict, 'REVIEW');
  assert.ok(j.check?.some(c => /MediaInfo нет/.test(c)));
});

// ---------- 2026-11-05 (редакция по длительности) ----------
test('[11-05] Вспомнить всё: «Ultimate Rekall Edition» той же длительности (1:53) — та же редакция, не REVIEW', () => {
  const j = v(spec(DV8, [dub()], { durationSec: 6797 }), spec(DV8, [dub()], { durationSec: 6797 - 40 }),
    { currentEditionText: 'Total Recall 1990 UHD BDRemux', candidateEditionText: 'Total Recall [Ultimate Rekall Edition]', currentTracker: 'TeamHD', candidateTracker: 'TeamHD' });
  assert.equal(j.dims.find(d => d.dim === 'редакция')!.cmp, 0);
  assert.notEqual(j.verdict, 'REVIEW');
});
test('[11-05] Патриот: длиннее на 10 мин без пометки в названии — REVIEW (смотрим по времени)', () => {
  const j = v(spec({}, [dub()], { durationSec: 9900 }), spec({}, [dub()], { durationSec: 10507 }));
  assert.equal(j.verdict, 'REVIEW');
  assert.ok(j.why?.some(w => /редакция/.test(w)));
});
test('[11-05] длительность важнее надписи: кандидат «Extended», но короче на 5 мин — REJECT', () => {
  const j = v(spec({}, [dub()], { durationSec: 9000 }), spec({}, [dub()], { durationSec: 8700 }), { candidateEditionText: '[Extended Cut]' });
  assert.equal(j.verdict, 'REJECT');
});
test('[11-05] длительность неизвестна у одной стороны — редакция по тексту, как раньше', () => {
  const j = v(spec({}, [dub()], { durationSec: 9000 }), spec({}, [dub()]), { candidateEditionText: '[Extended Cut]' });
  assert.equal(j.verdict, 'REVIEW');
});

// ---------- 2026-11-06 ----------
test('[11-06] Большой Лебовски: в файле «Дубляж, DVD Group» + отдельная MVO «BD-CEE» — дубляж есть, кандидат с Dub не выигрыш', () => {
  const cur = spec({}, [
    { kind: 'dub', title: 'Дубляж, DVD Group', codec: 'AC3', channels: 6 },
    { kind: 'mvo', author: 'ТК "1-й Канал"', title: 'Многоголосый закадровый, ТК "1-й Канал" / BD-CEE', codec: 'DTS', channels: 2 },
  ]);
  const cand = spec({}, [
    { kind: 'mvo', author: 'ТК "1-й Канал"', title: 'MVO 1-й Канал BD-CEE', codec: 'DTS', channels: 2 },
    { kind: 'dub', title: 'Dub', codec: 'AC3', channels: 6 },
  ]);
  const j = v(cur, cand);
  assert.notEqual(j.dims.find(d => d.dim === 'русский дубляж')!.current, 'нет');
  assert.equal(j.verdict, 'KEEP');
});
test('[11-06] Большой Лебовски: DTS-HD MA без «Compression mode» в MediaInfo — всё равно lossless, оригинал не «хуже»', () => {
  const cur = spec({}, [dub()]), cand = spec({}, [dub()]);
  cand.audio = cand.audio.map(a => a.kind === 'original' ? { ...a, codec: 'DTS-HD MA', lossless: false, atmos: false } : a);
  cur.audio = cur.audio.map(a => a.kind === 'original' ? { ...a, codec: 'DTS-HD MA', lossless: true, atmos: false } : a);
  assert.equal(v(cur, cand).dims.find(d => d.dim === 'оригинал')!.cmp, 0);
});

test('[11-06] Две крепости Extended: дубляж «Мосфильм-Мастер + Позитив на Extended Edition» (Blu-ray CEE + MVO) — пока REVIEW, не автозамена', () => {
  const cur = spec({}, [{ kind: 'mvo', author: 'Позитив-Мультимедиа', title: 'Многоголосый закадровый, Позитив-Мультимедиа', codec: 'DTS-HD MA', lossless: true }]);
  const cand = spec({}, [
    { kind: 'dub', author: 'Мосфильм-Мастер + Позитив Мультимедиа на Extended Edition', title: 'Дубляж, Blu-ray CEE + MVO', codec: 'AC3' },
    { kind: 'mvo', author: 'Позитив Мультимедиа', title: 'Многоголосый, Позитив Мультимедиа', codec: 'DTS-HD MA', lossless: true },
  ]);
  const j = v(cur, cand, { currentEditionText: 'Extended', candidateEditionText: 'Extended' });
  assert.equal(j.verdict, 'REVIEW');
  assert.ok(j.check?.some(c => /вставками/.test(c)));
});

test('[11-06] Храброе сердце: TeamHD «BDRemux» в BDMV-контейнере — REJECT, даже если звук лучше (Atmos)', () => {
  const cur = spec({}, [dub()]);
  const cand = spec({}, [dub()], { container: 'bdmv' } as any);
  cand.audio = cand.audio.map(a => a.kind === 'original' ? { ...a, atmos: true } : a);
  const j = v(cur, cand);
  assert.equal(j.verdict, 'REJECT');
  assert.match(j.reasons.join(' '), /BDMV/);
});
