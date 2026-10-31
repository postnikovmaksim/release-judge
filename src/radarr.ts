import { config } from './config.js';

export async function radarr<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(`${config.radarr.url}/api/v3${path}`, {
    ...init, headers: { 'X-Api-Key': config.radarr.apiKey, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  if (!r.ok) throw new Error(`radarr ${path}: ${r.status} ${await r.text()}`);
  return r.status === 204 ? (undefined as T) : r.json() as Promise<T>;
}
