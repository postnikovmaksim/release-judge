/**
 * Отчёт BDInfo (TeamHD выкладывает его вместо MediaInfo у ремуксов с BDMV) -> треки в формате mediainfo-JSON.
 * Названий дорожек в BDInfo нет: тип/автора потом добирает сводка «Аудио#N: … |Дубляж, …|».
 */
type Track = Record<string, string | undefined>;
const CH: Record<string, string> = { '7.1': '8', '6.1': '7', '5.1': '6', '5.0': '5', '2.0': '2', '1.0': '1' };

export const looksLikeBdinfo = (t: string) => /PLAYLIST REPORT|DISC INFO/i.test(t) && /^\s*AUDIO:\s*$/m.test(t);

export function parseBdinfo(text: string): Track[] {
  const lines = text.replace(/<br\s*\/?>/gi, '\n').replace(/\r/g, '\n').split('\n').map(l => l.replace(/\u00a0/g, ' '));
  const tracks: Track[] = [{ '@type': 'General' }];
  let section = '';
  for (const raw of lines) {
    const l = raw.trimEnd();
    const sec = l.trim().match(/^(VIDEO|AUDIO|SUBTITLES|FILES|CHAPTERS|STREAM DIAGNOSTICS|PLAYLIST REPORT|DISC INFO):?\s*$/i);
    if (sec) { section = sec[1].toUpperCase(); continue; }
    if (!l.trim() || /^-{3,}|^Codec\s{2,}/.test(l.trim())) continue;
    if (section === 'VIDEO') {
      const m = l.match(/^(\*\s*)?(.+?Video)\s+([\d,.]+)\s*kbps\s+(.*)$/i);
      if (!m) continue;
      const desc = m[4];
      if (m[1]) {                                                   // скрытый поток: слой Dolby Vision
        const v = tracks.find(t => t['@type'] === 'Video');
        if (v && /dolby vision/i.test(desc)) v.HDR_Format = `Dolby Vision, Profile 7.6, dvhe.07.06, BL+EL+RPU / ${v.HDR_Format ?? ''}`;
        continue;
      }
      const res = desc.match(/(\d{3,4})p/)?.[1];
      tracks.push({ '@type': 'Video', Format: /HEVC/i.test(m[2]) ? 'HEVC' : /AVC/i.test(m[2]) ? 'AVC' : m[2],
        BitRate: String(Math.round(Number(m[3].replace(/,/g, '')) * 1000)),
        Height: res, Width: res === '2160' ? '3840' : res === '1080' ? '1920' : undefined,
        HDR_Format: [/dolby vision/i.test(desc) ? 'Dolby Vision, Profile 7.6, dvhe.07.06' : '', /HDR10\+/i.test(desc) ? 'SMPTE ST 2094 App 4, HDR10+' : '',
          /HDR10(?!\+)/i.test(desc) ? 'SMPTE ST 2086, HDR10 compatible' : ''].filter(Boolean).join(' / ') || undefined,
        transfer_characteristics: /\bPQ\b/.test(desc) ? 'PQ' : /HLG/.test(desc) ? 'HLG' : undefined });
    } else if (section === 'AUDIO') {
      const m = l.trim().match(/^(.+?Audio)\s+([A-Za-zА-Яа-я-]+)\s+([\d,.]+)\s*kbps\s+(.*)$/i);
      if (!m) continue;
      const codec = m[1];
      const ch = m[4].match(/^(\d\.\d)/)?.[1];
      tracks.push({ '@type': 'Audio', Language: m[2],
        Format: /TrueHD/i.test(codec) ? 'MLP FBA' : /Master/i.test(codec) ? 'DTS' : /Plus/i.test(codec) ? 'E-AC-3' : /Dolby Digital/i.test(codec) ? 'AC-3' : /DTS/i.test(codec) ? 'DTS' : /LPCM|PCM/i.test(codec) ? 'PCM' : codec,
        Format_Commercial_IfAny: /TrueHD/i.test(codec) ? `Dolby TrueHD${/atmos/i.test(codec) ? ' with Dolby Atmos' : ''}` : /Master/i.test(codec) ? 'DTS-HD Master Audio' : undefined,
        Format_AdditionalFeatures: /Master/i.test(codec) ? 'XLL' : undefined,
        Compression_Mode: /TrueHD|Master|LPCM|PCM/i.test(codec) ? 'Lossless' : 'Lossy',
        Channels: ch ? CH[ch] : undefined, BitRate: String(Math.round(Number(m[3].replace(/,/g, '')) * 1000)) });
    } else if (section === 'SUBTITLES') {
      const m = l.trim().match(/^(Presentation Graphics|.+?)\s+([A-Za-zА-Яа-я-]+)\s+[\d.,]+\s*kbps/);
      if (m) tracks.push({ '@type': 'Text', Format: /Presentation/i.test(m[1]) ? 'PGS' : m[1], Language: m[2], Forced: 'No' });
    }
  }
  for (const t of tracks) if (t["@type"] === "Video" && /dolby vision/i.test(t.HDR_Format ?? "")) { t.HDR_Format_Profile = "dvhe.07.06"; t.HDR_Format_Settings = "BL+EL+RPU"; }
  return tracks;
}
