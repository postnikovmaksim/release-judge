import { createHash } from 'node:crypto';

/** Минимальный bencode-декодер: строки — Buffer, плюс сырой срез info для infohash (v1). */
export type BVal = number | Buffer | BVal[] | { [k: string]: BVal };

export function decode(buf: Buffer): { value: BVal; infoRaw?: Buffer } {
  let i = 0, infoStart = -1, infoEnd = -1, depth = 0;
  const read = (): BVal => {
    const c = buf[i];
    if (c === 0x69) { const e = buf.indexOf(0x65, i); const n = Number(buf.subarray(i + 1, e).toString()); i = e + 1; return n; }   // i…e
    if (c === 0x6c) { i++; depth++; const a: BVal[] = []; while (buf[i] !== 0x65) a.push(read()); i++; depth--; return a; }       // l…e
    if (c === 0x64) {                                                                                                                // d…e
      i++; depth++; const o: Record<string, BVal> = {};
      while (buf[i] !== 0x65) {
        const k = (read() as Buffer).toString('utf8');
        if (k === 'info' && depth === 1) { infoStart = i; o[k] = read(); infoEnd = i; } else o[k] = read();
      }
      i++; depth--; return o;
    }
    if (c >= 0x30 && c <= 0x39) { const colon = buf.indexOf(0x3a, i); const len = Number(buf.subarray(i, colon).toString()); i = colon + 1 + len; return buf.subarray(colon + 1, i); }
    throw new Error(`bencode: неожиданный байт ${c} на ${i}`);
  };
  const value = read();
  return { value, infoRaw: infoStart >= 0 ? buf.subarray(infoStart, infoEnd) : undefined };
}

export interface TorrentMeta { infoHash: string; name: string; files: { path: string; size: number }[]; totalSize: number; multiFile: boolean; }

/** .torrent → infohash v1 + список файлов (пути относительно корня раздачи, без имени папки). */
export function parseTorrent(buf: Buffer): TorrentMeta {
  const { value, infoRaw } = decode(buf);
  const info = (value as any).info;
  if (!info || !infoRaw) throw new Error('в .torrent нет info');
  const str = (b: any) => (Buffer.isBuffer(b) ? b.toString('utf8') : String(b));
  const name = str(info['name.utf-8'] ?? info.name);
  const files = info.files
    ? (info.files as any[]).map(f => ({ path: (f['path.utf-8'] ?? f.path).map(str).join('/'), size: Number(f.length) }))
    : [{ path: name, size: Number(info.length) }];
  return { infoHash: createHash('sha1').update(infoRaw).digest('hex'), name, files: files.filter(f => !/(^|\/)\.pad\//.test(f.path)),
    totalSize: files.reduce((s, f) => s + f.size, 0), multiFile: !!info.files };
}
