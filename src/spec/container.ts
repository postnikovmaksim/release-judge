/** Структура диска в раздаче: папка BDMV или потоки .m2ts (TeamHD «BDRemux» с отчётом BDInfo бывает именно таким). */
export const isDiscLayout = (paths: string[]) => paths.some(p => /(^|\/)BDMV\//i.test(p) || /\.(m2ts|mpls|clpi)$/i.test(p) || /(^|\/)VIDEO_TS\//i.test(p));
/** Стоит ли смотреть файлы .torrent: на странице признаки диска. */
export const mayBeDisc = (html: string, hasBdinfo: boolean) => hasBdinfo || /\bBDMV\b|\.m2ts\b|Disc Label/i.test(html);
