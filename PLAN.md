# poly-paper: план выделения в отдельный HTTP-сервис

Цель: standalone HTTP-сервис, эмулирующий торговую часть Polymarket (выставление/отмена
ордеров, статусы, сделки, баланс USDC и токенов) на реальных рыночных данных. Робот
перестаёт содержать бумажную логику и общается с сервисом по HTTP.

Принятые решения: API повторяет маршруты poly-gate (робот меняет только `poly_gate.url`),
один кошелёк на процесс, состояние в Mongo, HTTP на Fastify + zod.

**Статус: реализовано.** Инструкции по запуску и описание API — в `README.md`.

## 1. Исходное состояние репозитория

В репозиторий были скопированы файлы из проекта робота, код не собирался:

| Проблема | Где |
| --- | --- |
| Нет runtime-зависимостей, версии `catalog:` (pnpm workspace) не резолвятся в отдельном репо | `package.json` |
| Нет `type: "module"`, нет скриптов build/dev/test | `package.json` |
| Отсутствует модуль `src/utils/`: `removeNones`, `Signal`, `sleep` | нужен `mongo.ts`, `socket/marketSocket.ts` |
| Пути `../../` после «сплющивания» каталогов (было `socket/market/*`) | `socket/marketSocket.ts`, `socket/parse.ts`, `socket/types.ts` |
| `import { Scheduler } from "./message-queue"` — каталог называется `messageQueue` | `market.ts` |
| Импорты без `.js` — нарушают `nodenext` + `verbatimModuleSyntax` | `storage.ts`, `matching.ts`, `market.ts`, `paperExecution.ts` |
| Нет `.gitignore`, `config.yaml` | корень |

Переиспользовано: логика резервов и филлов, документы Mongo, алгоритм матчинга по сделкам,
тик-цикл с redeem, клиент шлюза, market WebSocket, `config`, `logging`, `messageQueue`.

Удалено как точки интеграции внутри робота: `client/execution.ts` (`ExecutionPort`,
`setExecutionPort`), `client/liveExecution.ts`, `client/order.ts`, `client/balance.ts`,
`client/userTrades.ts`. Из клиента шлюза убраны торговые методы и авторизация — сервису
нужны только рыночные данные, а они не требуют токена.

## 2. Архитектура

```
src/
  index.ts            bootstrap: config → logging → mongo → индексы → engine.start() → http.listen()
  config.ts           чтение config.yaml (путь можно переопределить POLY_PAPER_CONFIG)
  settings.ts         типизированные настройки одним объектом
  logging.ts          pino + опциональный sink в Mongo
  mongo.ts            клиент и подключение
  types.ts            Side, Millis, OrderStatus, OrderBook
  http/
    app.ts            сборка Fastify, обработка ошибок
    schema.ts         zod-схемы запросов/ответов
    clobFormat.ts     рендер ордеров и сделок в соглашениях CLOB
    routes/clob.ts    торговые эндпоинты (эмуляция)
    routes/market.ts  проксирование рыночных данных в реальный poly-gate
    routes/paper.ts   /health, кошелёк, позиции, PnL, ордера
  domain/
    matching.ts       матчинг по сделкам и по книге
    money.ts          арифметика денег, позиции, mark-to-market
    order.ts          валидация ордера: tick size, min size, цена в (0,1)
  storage/            репозитории Mongo: wallet, orders, trades, markets, tradeEvents
  service/
    orders.ts         постановка, отмена, чтение ордеров
    fills.ts          применение филла: ордер + сделка + кошелёк
    wallet.ts         балансы, позиции, портфель, reset/deposit
  marketData/         клиент апстрим-шлюза + market WebSocket Polymarket
  engine/
    matcher.ts        тик: LIVE-ордера × поток сделок
    resolver.ts       отмена ордеров и redeem на разрешённых рынках
```

Слой `service/` появился сверх исходного плана: и HTTP-запросы, и фоновый тик применяют
филлы одним и тем же кодом, дублировать эту логику в двух местах было бы опасно.

## 3. HTTP API

Полное описание — в `README.md` и в Swagger UI на `/docs`. Схемы описаны один раз: zod-схемы
маршрутов конвертируются в JSON Schema (`fastify-type-provider-zod`), из них `@fastify/swagger`
собирает OpenAPI, так что валидация и документация не разъезжаются. Теги: `clob`, `market`,
`paper`.

Детали совместимости, которые легко упустить:

- `created_at` и `match_time` отдаются **в секундах** (робот делает `secToMs`), суммы и цены —
  десятичными строками, как у CLOB. Внутри всё в миллисекундах и числах.
- `orderType` в теле `POST /clob/order` принимается, но игнорируется. Тик и минимальный
  размер берутся из живой книги.
- Отказ («нет денег», «цена не по тику») — это `200` с `{ ok: false, errorMsg }`, иначе
  робот получит исключение вместо штатного ответа. Успех — `{ ok, orderId, status,
  makingAmount, takingAmount, tradeIds, transactionsHashes }` как у текущего poly-gate.
- Поле `owner` в сделках заполняется из `polymarket.api_key` конфига сервиса: робот
  оставляет только сделки со своим api key, поэтому значения должны совпадать.
- `poly_gate.token` робота не проверяется, но у робота он должен быть непустым — его клиент
  падает на пустом токене.

## 4. Что исправлено в перенесённой логике

1. **Атомарность кошелька.** Было read-modify-write (`getWallet` → мутация → `replaceWallet`),
   что в сервисе теряло бы апдейты между HTTP-запросами и тиком. Теперь каждая операция —
   один guarded update: резерв USDC это `$inc` под фильтром `usdc_available: { $gte: cost }`.
2. **Отмена ровно один раз.** Отмена делает `findOneAndUpdate` со `status: "LIVE"` и работает
   с пред-образом документа, поэтому резерв освобождает только победитель гонки — раньше
   отмена и резолвер могли освободить его дважды.
3. **Частичные филлы.** Было: филл целиком на весь размер одной сделкой. Стало: накопление
   `size_matched`, отдельная сделка на каждый филл, статус LIVE до полного исполнения (как на
   CLOB — отдельного `PARTIALLY_MATCHED` там нет). Разблокировка резерва BUY считается
   телескопически, поэтому дробные филлы не оставляют пыли в `usdc_reserved`.
4. **Мгновенное исполнение по книге.** `tryMatchOneLevel` был написан, но не использовался.
   Теперь ордер, пересекающий книгу при постановке, исполняется по её ценам с учётом
   глубины (`paper.instant_taker_fill`).
5. **Курсор по потоку сделок.** Было: каждый тик перечитывал все события с момента создания
   ордера и решал «всё или ничего». Стало: у ордера свой курсор по `_id` событий, тик смотрит
   только новое, а не подошедшие события пропускаются навсегда — цена лимита не меняется.
6. **Валидация.** Добавлены проверки тика, `min_order_size`, диапазона цены и закрытости рынка.
7. **Убрана загрузка книги на каждый ордер в каждом тике** — раньше она была нужна только
   чтобы заметить исчезновение рынка, чем теперь занимается резолвер.

Не реализовано осознанно: комиссии (на CLOB сейчас нулевые), задержка перехода в LIVE,
приоритет в очереди, влияние своего ордера на книгу.

## 5. Этапы

Все выполнены.

| # | Этап | Результат |
| --- | --- | --- |
| 0 | Сборка зелёная | deps и скрипты, `src/utils/`, пути импортов, `.gitignore`, `tsconfig.test.json` |
| 1 | Скелет сервиса | Fastify, `/health`, Swagger UI, bootstrap, graceful shutdown |
| 2 | Домен и хранилище | Чистые матчинг/деньги/валидация, атомарные операции кошелька |
| 3 | Торговые эндпоинты | order / cancel / get order / user-trades / балансы |
| 4 | Рыночные данные | Прокси к шлюзу, подписка MarketSocket на активные рынки |
| 5 | Матчер | Тик-цикл с курсором, частичные филлы, мгновенный кросс, resolver + redeem |
| 6 | Служебный API | Кошелёк, позиции, портфель с PnL, список ордеров, cancel-all |
| 7 | Тесты | 59 тестов: домен + e2e через `fastify.inject`, in-memory Mongo, поддельный шлюз |
| 8 | Интеграция | README с запуском и порядком переключения робота |

## 6. Зависимости

Runtime: `fastify`, `@fastify/swagger`, `@fastify/swagger-ui`, `fastify-type-provider-zod`,
`zod`, `mongodb`, `pino`, `pino-pretty`, `yaml`, `ws`.
Dev: `typescript`, `@types/node`, `@types/ws`, `vitest`, `mongodb-memory-server`, `tsx`.

## 7. Запуск

Сервис локальный, контейнеров нет: `pnpm dev` (tsx watch) или `pnpm build && pnpm start`,
рядом локальная Mongo. Конфиг — `config.yaml` в корне, пример со всеми ключами —
`config_example.yaml`.

## 8. Что осталось сделать в роботе

Отдельная задача уже вне этого репозитория: переключить `poly_gate.url`, синхронизировать
`polymarket.api_key` и удалить из робота `PaperExecution`, `PaperMarket`, `ExecutionPort` и
бумажные коллекции.
