import { config } from '../config.js';

/** qBittorrent WebUI API (v5; доступ без логина из LAN). */
export async function qb(base: string, path: string, form?: Record<string, string> | FormData): Promise<any> {
  const init: RequestInit = form ? { method: 'POST', body: form instanceof FormData ? form : new URLSearchParams(form) } : {};
  const r = await fetch(`${base}/api/v2${path}`, init);
  if (!r.ok) throw new Error(`qbit ${base}${path}: ${r.status} ${await r.text()}`);
  const t = await r.text();
  try { return JSON.parse(t); } catch { return t; }
}

export async function sonarr<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(`${config.sonarr.url}/api/v3${path}`, { ...init, headers: { 'X-Api-Key': config.sonarr.apiKey, 'Content-Type': 'application/json', ...(init.headers ?? {}) } });
  if (!r.ok) throw new Error(`sonarr ${path}: ${r.status} ${await r.text()}`);
  return r.status === 204 ? (undefined as T) : r.json() as Promise<T>;
}
