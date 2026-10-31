import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
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
  prowlarr: { url: env('PROWLARR_URL', 'http://prowlarr:9696'), apiKey: env('PROWLARR_API_KEY', '') },
  hardlinks: { url: env('HARDLINKS_URL', 'http://media-hardlinks:3000') },
  llm: {
    baseURL: env('LLM_BASE_URL', 'http://litellm:4000/v1'),
    apiKey: env('LLM_API_KEY', ''),
    model: env('LLM_MODEL', 'extract'),               // model group в LiteLLM
  },
};

export function loadRules(): any {
  const own = join(config.configDir, 'rules.yaml');
  const file = existsSync(own) ? own : join(config.configDir, 'rules.example.yaml');
  return YAML.parse(readFileSync(file, 'utf8'));
}
