import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);

/** Профиль Dolby Vision и наличие enhancement layer (P7: FEL/MEL ffprobe не различает — нужен dovi_tool). */
export async function doviInfo(path: string): Promise<{ profile?: number; el?: boolean }> {
  try {
    const { stdout } = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
      '-show_entries', 'stream_side_data=dv_profile,el_present_flag', '-of', 'json', path], { maxBuffer: 8 << 20 });
    const sd = JSON.parse(stdout).streams?.[0]?.side_data_list?.find((s: any) => s.dv_profile !== undefined);
    return sd ? { profile: sd.dv_profile, el: sd.el_present_flag === 1 } : {};
  } catch { return {}; }
}
