# poly-paper: план выделения в отдельный HTTP-сервис

Цель: standalone HTTP-сервис, эмулирующий торговую часть Polymarket (выставление/отмена
ордеров, статусы, сделки, баланс USDC и токенов) на реальных рыночных данных. Робот
перестаёт содержать бумажную логику и общается с сервисом по HTTP.

Принятые решения: API повторяет маршруты poly-gate (робот меняет только `poly_gate.url`),
один кошелёк на процесс, состояние в Mongo, HTTP на Fastify + zod.

## 1. Текущее состояние репозитория

В репозиторий скопированы файлы из проекта робота. Код **не собирается**:

| Проблема | Где |
| --- | --- |
| Нет runtime-зависимостей, версии `catalog:` (pnpm workspace) не резолвятся в отдельном репо | `package.json` |
| Нет `type: "module"`, нет скриптов build/dev/test | `package.json` |
| Отсутствует модуль `src/utils/`: `removeNones`, `Signal`, `sleep` | нужен `mongo.ts`, `socket/marketSocket.ts` |
| Пути `../../` после «сплющивания» каталогов (было `socket/market/*`) | `socket/marketSocket.ts`, `socket/parse.ts`, `socket/types.ts` |
| `import { Scheduler } from "./message-queue"` — каталог называется `messageQueue` | `market.ts` |
| Импорты без `.js` (`./client`, `./types`, `./config`, `./logging`, `./mongo`) — нарушают `nodenext` + `verbatimModuleSyntax` | `storage.ts`, `matching.ts`, `market.ts`, `paperExecution.ts` |
| Нет `.gitignore`, `config.yaml` | корень |

Что уже есть и переиспользуется: `PaperExecution` (резервы/ордера), `storage.ts` (Mongo-
документы кошелька/ордеров/сделок/рынков), `matching.ts` (два алгоритма матчинга),
`PaperMarket` (тик-цикл + redeem по итогам рынка), клиент poly-gate, market WebSocket,
`config`, `logging`, `messageQueue`.

Что уходит: `client/execution.ts` (`ExecutionPort`, `setExecutionPort`), `client/order.ts`,
`client/balance.ts`, `client/userTrades.ts`, `client/liveExecution.ts` — это точки
интеграции внутри робота, сервису они не нужны. Остаётся только клиент к poly-gate для
рыночных данных.

## 2. Целевая архитектура

```
src/
  index.ts            bootstrap: config → logging → mongo → индексы → engine.start() → http.listen()
  config.ts           как есть
  logging.ts          как есть
  http/
    app.ts            сборка Fastify, хуки, обработка ошибок
    swagger.ts        регистрация @fastify/swagger + swagger-ui
    routes/clob.ts    торговые эндпоинты (эмуляция)
    routes/market.ts  проксирование рыночных данных в реальный poly-gate
    routes/admin.ts   /health, кошелёк, позиции, PnL
    schema.ts         zod-схемы запросов/ответов
  domain/
    matching.ts       чистые функции матчинга (из matching.ts)
    wallet.ts         чистая арифметика резервов/филлов
    order.ts          валидация ордера: tick size, min size, цена в (0,1)
  storage/            репозитории Mongo (из storage.ts)
  marketData/         клиент poly-gate + MarketSocket + кэш книг
  engine/
    matcher.ts        фоновый тик-цикл: LIVE-ордера × trade events
    resolver.ts       закрытие рынков и redeem выигрышных токенов
```

Разделение важно потому, что сейчас в одном процессе будут одновременно писать в кошелёк
HTTP-запросы и фоновый матчер — арифметику надо вынести и сделать атомарной (см. §4).

## 3. HTTP API

Сервис отвечает на те же маршруты, что робот уже вызывает через `PolyGateClient`, поэтому
интеграция = смена `poly_gate.url` в конфиге робота, без нового кода в роботе.

Торговля (эмулируется):

| Метод | Путь | Ответ |
| --- | --- | --- |
| POST | `/clob/order` | `{ orderID, success }` |
| DELETE | `/clob/order` | `{ canceled: [id], success }` |
| GET | `/clob/order/:orderID` | `status, price, original_size, size_matched, created_at, associate_trades` |
| GET | `/clob/user-trades?id=` | массив сделок в формате шлюза |
| GET | `/clob/usdc-balance` | `{ balance }` |
| GET | `/clob/token-balance?token_id=` | `{ balance }` |

Рыночные данные (прозрачный прокси в реальный poly-gate, чтобы у робота был один URL):
`GET /clob/order-book`, `POST /clob/order-books`, `GET /clob/markets/:conditionId`.

Служебные (уже вне контракта шлюза): `GET /health`, `GET /paper/wallet`,
`POST /paper/wallet/reset`, `POST /paper/wallet/deposit`, `GET /paper/orders?status=`,
`GET /paper/positions` (с mark-to-market PnL), `POST /paper/orders/cancel-all`.

Документация: Swagger UI на `/docs`, спека на `/docs/json`. Схемы описываются один раз —
zod-схемы маршрутов конвертируются в JSON Schema (`fastify-type-provider-zod`), из которых
`@fastify/swagger` собирает OpenAPI. Так валидация запросов и документация не разъезжаются.
Маршруты группируются тегами `clob`, `market`, `paper`.

Детали, которые легко упустить:

- `created_at` шлюз отдаёт **в секундах** (робот делает `secToMs`), а в Mongo мы храним
  миллисекунды — конвертировать на границе HTTP.
- `tickSize` в `POST /clob/order` приходит строкой (`clobTickSizeStr`), а не числом.
- Ошибки: недостаточный баланс — это не 500. Нужен явный контракт: `{ success: false,
  errorMsg }` со статусом 200, как ведёт себя CLOB, иначе робот увидит исключение.
- Авторизация: `PolyGateClient.authHeaders()` требует непустой `poly_gate.token` и шлёт
  `Bearer`. Сервис должен принимать этот заголовок; проверять его или игнорировать —
  решается конфигом, но 401 на пустом токене ломать не надо.

## 4. Что стоит починить в перенесённой логике

1. **Атомарность кошелька.** `storage.ts` делает read-modify-write (`getWallet` →
   мутация → `replaceWallet`). В сервисе параллельные запросы и тик матчера будут
   терять апдейты. Переписать на `findOneAndUpdate` с `$inc` и фильтром-гардом
   (`usdc_available: { $gte: cost }`) — резерв становится одной атомарной операцией.
2. **Частичные филлы.** Сейчас `applyMatch` заполняет ордер целиком одной сделкой
   (`fillQty = original_size`), статуса `PARTIALLY_MATCHED` нет. Накапливать
   `size_matched` и создавать несколько сделок.
3. **Мгновенный тейкер-филл.** При выставлении ордер никогда не исполняется сразу, даже
   если он пересекает книгу; `tryMatchOneLevel` написан, но не используется. Проверять
   кросс с книгой в момент постановки.
4. **Валидация.** Ни tick size, ни `min_order_size`, ни закрытость рынка при постановке
   ордера не проверяются.
5. **Опционально, конфигом:** комиссии, задержка перед переходом ордера в LIVE,
   проскальзывание.

## 5. Этапы

| # | Этап | Содержание |
| --- | --- | --- |
| 0 | Сборка зелёная | `package.json` (deps + scripts), `src/utils/`, починка путей импортов, `.gitignore`, `config.yaml`, `tsc --noEmit` проходит |
| 1 | Скелет сервиса | Fastify + `/health` + Swagger UI, bootstrap, graceful shutdown, подключение Mongo и индексов |
| 2 | Домен и хранилище | Вынос чистой логики, атомарные операции кошелька |
| 3 | Торговые эндпоинты | order / cancel / get order / user-trades / балансы |
| 4 | Рыночные данные | Прокси к poly-gate, подписка MarketSocket на активные рынки |
| 5 | Матчер | Тик-цикл, частичные филлы, мгновенный кросс, resolver + redeem |
| 6 | Служебный API | Кошелёк, позиции, PnL, cancel-all |
| 7 | Тесты | Юнит на матчинг и арифметику кошелька; e2e через `fastify.inject` + `mongodb-memory-server`, poly-gate замокан |
| 8 | Интеграция | Переключение `poly_gate.url` в роботе, удаление paper-кода из робота, README с запуском |

## 6. Зависимости

Runtime: `fastify`, `@fastify/swagger`, `@fastify/swagger-ui`, `fastify-type-provider-zod`,
`zod`, `mongodb`, `pino`, `pino-pretty`, `yaml`, `ws`.
Dev: `typescript`, `@types/node`, `@types/ws`, `vitest`, `mongodb-memory-server`, `tsx`.
Версии проставить явно вместо `catalog:`.

## 7. Запуск

Сервис локальный, контейнеров нет: `pnpm dev` (tsx watch) или `pnpm build && pnpm start`,
рядом локальная Mongo. Конфиг — `config.yaml` в корне (`server.host/port`, `db.*`,
`poly_gate.url` апстрима, `paper.initial_usdc`).
