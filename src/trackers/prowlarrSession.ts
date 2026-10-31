import Database from 'better-sqlite3';
import { copyFileSync, existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { config } from '../config.js';
import type { TrackerDef } from './registry.js';

/**
 * Сессии трекеров берём у Prowlarr (он сам логинится и обновляет cookie).
 * БД в WAL-режиме: копируем .db + -wal + -shm во временную папку и читаем копию — Prowlarr не блокируем.
 */
interface Session { cookie: string; userAgent?: string; }
let cache: { at: number; rows: { Name: string; Settings: string; Cookies: string | null }[] } | null = null;

function rows() {
  if (cache && Date.now() - cache.at < 10 * 60_000) return cache.rows;
  const src = config.prowlarr.db;
  const dir = mkdtempSync(join(tmpdir(), 'prowlarr-'));
  for (const sfx of ['', '-wal', '-shm']) if (existsSync(src + sfx)) copyFileSync(src + sfx, join(dir, 'prowlarr.db' + sfx));
  const db = new Database(join(dir, 'prowlarr.db'), { readonly: true, fileMustExist: true });
  const r = db.prepare(`SELECT i.Name, i.Settings, s.Cookies FROM Indexers i LEFT JOIN IndexerStatus s ON s.ProviderId = i.Id`).all() as any[];
  db.close();
  cache = { at: Date.now(), rows: r };
  return r;
}

export function sessionFor(t: TrackerDef): Session | undefined {
  const row = rows().find(r => t.prowlarrName.test(r.Name));
  if (!row) return undefined;
  const settings = JSON.parse(row.Settings || '{}');
  const extra = settings.extraFieldData ?? {};
  if (t.cookieFrom === 'settings') return { cookie: extra.cookie, userAgent: extra.useragent };
  const jar = row.Cookies ? JSON.parse(row.Cookies) : {};
  const cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
  return cookie ? { cookie, userAgent: extra.useragent } : undefined;
}

export const invalidateSessions = () => { cache = null; };
