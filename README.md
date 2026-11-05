# release-judge

Сервис принимает решение о замене фильма на релиз **того же уровня качества** (Remux-2160p → Remux-2160p),
открывая страницу раздачи на трекере и сравнивая её с реальным файлом на диске.
Грубые шаги качества (WEB-DL → Remux, 1080p → 2160p) остаются за Radarr.

```
Prowlarr RSS / Radarr /release ─► discovery ─► fetch topic ─► parse (MediaInfo → LLM fallback) ─► spec
                                                              файл на диске ─► ffprobe/mediainfo ─► spec
                                                                         compare(rules.yaml) ─► UPGRADE / KEEP / REVIEW / REJECT
UPGRADE ─► Radarr grab {guid, indexerId} ─► ManualImport          REVIEW ─► n8n ─► Telegram (кнопки)
```

## Стек
Node 22 + TypeScript, Fastify, SQLite (better-sqlite3), cheerio + iconv-lite (cp1251), zod.
LLM — через OpenAI-совместимый шлюз LiteLLM (`deploy/litellm.config.yaml`), model group `extract`.

## Конфигурация
- `config/rules.yaml` — правила сравнения (пример: `config/rules.example.yaml`).
- env: см. `src/config.ts` и `deploy/docker-compose.yml`.

## Релиз
`git tag vX.Y.Z && git push --tags` → GitHub Actions собирает и пушит `postnikovm/release-judge:{X.Y.Z, X.Y, latest}`.
Нужны секреты репозитория: `DOCKERHUB_USERNAME`, `DOCKERHUB_TOKEN`.

## Этапы
1. Снимок библиотеки (mediainfo → `file_spec`)
2. Fetch + parse: TeamHD, RuTracker, Tapochek, Kinozal
3. Comparator в режиме `report`
4. Действия (`mode: act`) + Telegram REVIEW
5. Discovery: Prowlarr RSS + ротационный поиск

## Договорённости = тесты
`src/judge/decisions.test.ts` — каждое правило, согласованное по живым карточкам, записано как тест на реальном примере
(«[дата] фильм: ожидание — правило»). Новая договорённость → новый тест там же. Падение такого теста после правки логики —
нарушение принятого решения: чинится код, а не тест (тест меняется только если меняется само решение).
