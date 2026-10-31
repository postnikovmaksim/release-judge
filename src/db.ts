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
