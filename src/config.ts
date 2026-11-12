import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const env = (k: string, d?: string) => {
  const v = process.env[k] ?? d;
  if (v === undefined) throw new Error(`env ${k} is required`);
  return v;
};

export const config = {
  port: Number(env('PORT', '3100')),
  dataDir: env('DATA_DIR', './state'),
  configDir: env('CONFIG_DIR', './config'),
  radarr: { url: env('RADARR_URL', 'http://radarr:7878'), apiKey: env('RADARR_API_KEY', '') },
  prowlarr: { url: env('PROWLARR_URL', 'http://prowlarr:9696'), apiKey: env('PROWLARR_API_KEY', ''), db: env('PROWLARR_DB', '/prowlarr/prowlarr.db') },
  flaresolverr: { url: env('FLARESOLVERR_URL', 'http://flaresolverr:8191') },
  hardlinks: { url: env('HARDLINKS_URL', 'http://media-hardlinks:3000') },
  qbit: { urls: env('QBIT_URLS', 'http://192.168.1.6:8080,http://192.168.1.5:9080,http://192.168.1.7:9081').split(',').map(s => s.trim()).filter(Boolean) },
  telegram: { token: env('TELEGRAM_BOT_TOKEN', ''), chatId: env('TELEGRAM_CHAT_ID', '') },
  discovery: {
    at: env('DISCOVERY_AT', '02:30'),                       // локальное время ночного прогона (TZ контейнера)
    limit: Number(env('DISCOVERY_LIMIT', '30')),            // фильмов за прогон
    excludeIndexerIds: env('EXCLUDE_INDEXER_IDS', '16,17,18,19,20,21,22').split(',').map(Number),
    delayMs: Number(env('DISCOVERY_DELAY_MS', '4000')),
    maxCandidatesPerMovie: Number(env('DISCOVERY_MAX_CANDIDATES', '5')),
    recheckDays: Number(env('DISCOVERY_RECHECK_DAYS', '14')),
  },
  tz: env('TZ', 'Europe/Moscow'),
  llm: {
    baseURL: env('LLM_BASE_URL', 'http://litellm:4000/v1'),
    apiKey: env('LLM_API_KEY', ''),
    model: env('LLM_MODEL', 'extract'),               // model group в LiteLLM
  },
};

export function loadRules(): any {
  const own = join(config.configDir, 'rules.yaml');
  const bundled = fileURLToPath(new URL('../config/rules.example.yaml', import.meta.url));
  const file = existsSync(own) ? own : bundled;
  return YAML.parse(readFileSync(file, 'utf8'));
}

