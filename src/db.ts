import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './config.js';

mkdirSync(config.dataDir, { recursive: true });
export const db = new Database(join(config.dataDir, 'release-judge.sqlite'));
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS file_spec (        -- снимок файлов библиотеки
  movie_id INTEGER PRIMARY KEY, file_id INTEGER, path TEXT, mtime INTEGER,
  spec JSON NOT NULL, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS topic (            -- кэш страниц раздач
  url TEXT PRIMARY KEY, tracker TEXT, topic_updated TEXT,
  html_hash TEXT, spec JSON, parser TEXT, fetched_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS verdict (          -- решения comparator
  id INTEGER PRIMARY KEY AUTOINCREMENT, movie_id INTEGER, topic_url TEXT, guid TEXT, indexer_id INTEGER,
  verdict TEXT CHECK (verdict IN ('UPGRADE','KEEP','REVIEW','REJECT')),
  reasons JSON, decided_by TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS ignore_release (topic_url TEXT PRIMARY KEY, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
`);

db.exec(`
CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS movie_check (movie_id INTEGER PRIMARY KEY, checked_at TEXT, candidates INTEGER, note TEXT);
CREATE TABLE IF NOT EXISTS ignore_list (            -- отклонённые пользователем релизы (guid или URL топика)
  key TEXT PRIMARY KEY, movie_id INTEGER, title TEXT, source TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS tg_message (             -- карточки в Telegram: message_id -> вердикты
  message_id INTEGER PRIMARY KEY, movie_id INTEGER, verdict_ids JSON, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`);
// вердикты: решение пользователя
try { db.exec(`ALTER TABLE verdict ADD COLUMN user_decision TEXT`); } catch {}
try { db.exec(`ALTER TABLE verdict ADD COLUMN release_title TEXT`); } catch {}
try { db.exec(`ALTER TABLE verdict ADD COLUMN indexer TEXT`); } catch {}

export const kvGet = (k: string) => (db.prepare('SELECT v FROM kv WHERE k = ?').get(k) as any)?.v as string | undefined;
export const kvSet = (k: string, v: string) => db.prepare('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').run(k, v);
export const isIgnored = (...keys: (string | undefined)[]) =>
  keys.some(k => k && db.prepare('SELECT 1 FROM ignore_list WHERE key = ?').get(k));
export const addIgnore = (key: string, movieId: number | null, title: string | null, source: string) =>
  db.prepare('INSERT OR IGNORE INTO ignore_list (key, movie_id, title, source) VALUES (?, ?, ?, ?)').run(key, movieId, title, source);
