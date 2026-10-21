# Feedback Hub — frontend

Русский React / TypeScript / Vite клиент для API из [`../docs/contract.md`](../docs/contract.md). Все запросы идут на `/api` того же origin. Поддельных данных, SDK-заглушек и клиентских решений о публикации нет.

## Запуск

Node **24.22.0**, pnpm **12.5.1**, зависимости закреплены точно; `pnpm-lock.yaml` входит в репозиторий.

```sh
cd web
pnpm install --frozen-lockfile
API_PROXY_TARGET=http://127.0.0.1:18080 pnpm dev
pnpm typecheck
pnpm test
pnpm build
```

Vite работает на `http://localhost:5173`. Без `API_PROXY_TARGET` прокси использует `http://127.0.0.1:8080`. Он сохраняет исходные Host и Origin: для разработки backend должен разрешать `APP_ORIGIN=http://localhost:5173`. `changeOrigin` не включён. Production Go-сервер обслуживает `web/dist` и fallback SPA для `/`, `/new`, `/admin`.

Если системный shim pnpm пытается выйти в сеть или не работает, реальный бинарник на этой машине: `/home/kreoniz/.local/share/mise/installs/pnpm/12.5.1/pnpm` (без `/bin`). pnpm 12 может потребовать registry для собственной проверки lockfile; не отключайте supply-chain policy ради запуска. Кеш пакетов остаётся в стандартном дисковом store домашнего каталога, не в RAM-backed `/tmp`.

## Маршруты и поведение

- `/`: серверные поиск, проект, статус, сортировка по голосам/дате и страницы по 30 идей. Фильтры сохраняются в URL и работают с Back/Forward. Перед голосованием выдаётся HttpOnly visitor cookie через `/api/form`. Голос положительный и идемпотентный; повторное нажатие недоступно после подтверждения сервера.
- `/new?project=campus&type=bug`: для бага нужен только текст описания; выбор проекта предзаполнен ссылкой. Для идеи дополнительно нужен заголовок. Необязательные детали свёрнуты. Успех всегда нейтральный: UI не использует `duplicate` или receipt как ID отчёта и не раскрывает внутреннюю дедупликацию.
- `/admin`: проверка сессии, вход/выход, общие входящие с серверными фильтрами, деталями, независимыми статусом/приоритетом/модерацией/полнотой, приватной заметкой, спамом и связью с оригиналом по UUID. PATCH содержит только изменённые поля. Перед одобрением идеи показаны **точные публичные название и описание**, предупреждение о чувствительных данных. Детали, контекст и заметки никогда не включаются в публичный предпросмотр. Для багов одобрение недоступно. Проверка связей/циклов/прав всегда остаётся на сервере.

Сетевая ошибка не очищает форму и не повторяет мутацию. Истёкший form token обновляется отдельным GET; следующая отправка требует нового нажатия. Учитывается минимальный возраст токена 2 секунды. Черновик существует только в памяти текущей вкладки; перед уходом с заполненной формы браузер может предупредить о потере текста. Нет localStorage/sessionStorage, паролей или auth/form tokens в URL. Пароль очищается после успешного входа, CSRF живёт в памяти, session cookie — HttpOnly. Текст пользователей отображается обычными React children; raw HTML/Markdown не исполняется.

Безопасный контекст включён по умолчанию и раскрыт рядом с отправкой; его можно отключить в подробностях. Передаются только семейство браузера, валидная версия и безопасный URL источника, если он известен. Приложение читает только явные `project`, `type`, `source`, `version`/`app_version`; URL текущей страницы целиком не отправляется. Версия — 1–40 символов `[A-Za-z0-9._+-]`, первый символ буквенно-цифровой. Полный User-Agent не отправляется.

Allowlist источников строится **только из непустых канонических HTTPS URL `/api/projects` для известных проектов**, с точным совпадением origin. Сейчас подтверждён `https://campus.kreoniz.ru`; `unlikely-ui` без публичного URL определяется только явным параметром. Поддомены, похожие суффиксы, credentials, нестандартный порт и произвольные источники не подходят. Явный project имеет приоритет. В контексте сохраняется только origin и один из известных статических путей (`/`, `/schedule`, `/compare`, `/settings`, `/components`, `/docs`), иначе `/`. Query и fragment отбрасываются; сервер повторяет очистку и может дополнительно сокращать путь.

Краткая справка и подробности приватности открываются по «?» в navbar. Голос можно отменить повторным нажатием и вернуть; число голосов не означает число уникальных людей, cookie действует 365 дней. Для общей сети новый голос за то же предложение может задерживаться на 60 секунд. Все решения об учёте голосов принимает сервер.

## Unlikely UI: исследование и API

Проверено **2026-10-21** по [npm registry metadata](https://registry.npmjs.org/unlikely-ui), тегам [latest](https://registry.npmjs.org/unlikely-ui/latest) и [next](https://registry.npmjs.org/unlikely-ui/next): оба указывают на **`0.1.0-alpha.1`**, peers React/React DOM **`^19.3.1`**. В проекте точно закреплены `react@19.3.1`, `react-dom@19.3.1`, `unlikely-ui@0.1.0-alpha.1`. Integrity опубликованного tarball записан в lockfile. Используется registry release, без workspace link и локальной сборки библиотеки.

Прочитаны локальные [`USAGE.md`](../../unlikely-ui/USAGE.md) и [`docs/components.md`](../../unlikely-ui/docs/components.md), затем **установленные опубликованные** `node_modules/unlikely-ui/package.json`, `dist/components/*.d.ts`, `dist/theme.d.ts`, `dist/tokens.css` и реализации составных контролов. Локальный репозиторий библиотеки не изменялся. Упомянутый в локальной документации `ScrollArea` — unreleased; фронтенд его не импортирует.

Выбор API:

- Документированные публичные subpaths, один импорт `unlikely-ui/styles.css`; Tailwind и сторонний reset не нужны. CSS приложения отвечает за layout и использует `--u-canvas`, `--u-surface`, `--u-ink`, `--u-muted`, `--u-line-soft` и другие семантические токены. Приватные `--u-ref-*` не используются. Радиусы/типографика заданы через типизированные `Theme.tokens`, чтобы наследоваться порталами.
- `Button`: реальные `primary`, `secondary`, `ghost`; `loading` блокирует повторное нажатие; для ссылок `render={<a/>}` и `nativeButton={false}`, без `asChild`. Иконки декоративны, действия с одной иконкой имеют `aria-label`.
- `Field.Root/Label/Description/Error` связывают поля с подписями; приложение передаёт внешнюю валидацию через `invalid` и `Error match={true}`. `Input`/`Textarea` используют `onValueChange`.
- `Select.Root` получает `items`, контролируемые `value/onValueChange`, затем `Trigger/Value/Content/Item`. `RadioGroup` с `variant="segmented"` выбирает тип сообщения; `Checkbox` — контекст. Нативные `details/summary` подходят для сворачивания необязательного текста.
- `Dialog.Content` уже содержит portal, backdrop, scroll viewport и theme restoration; двойного портала нет. Диалог имеет Title/Description, явное закрытие, Escape и восстановление фокуса. `Card`, `Badge`, `Alert`, `Skeleton`, `Spinner` используются по опубликованным контрактам; отдельных самодельных замен контролов нет.

Светлая тема по умолчанию, тёмная переключается без сохранения. Мобильная сетка проверяется на 320/390 px, desktop — 1280 px. Используются видимый keyboard focus, skip link, подписи, статусы, семантические landmark/heading, reduced motion. У формы нет лишних обязательных шагов.

## Тесты и браузерные prerequisites

```sh
pnpm test                         # unit: privacy, API failures, validation, patches, pagination
pnpm build                        # typecheck + production build
FEEDBACK_TEST_URL=http://localhost:18080 pnpm test:e2e
PLAYWRIGHT_BROWSER=firefox pnpm test:e2e --grep 'public screens'
```

Для полного E2E нужен **изолированный реальный Go API с тестовой БД** и секрет `FEEDBACK_TEST_PASSWORD` в окружении. Root script `../scripts/test-e2e.sh` поднимает такой сервер и экспортирует секрет приватно; не передавайте пароль аргументом команды и не используйте production. Мутационный тест пропускается, если переменная отсутствует. Он создаёт ровно **три отчёта**, запускается одним worker, без автоматических retries; лимит реального сервера — 6 отправок/час на сеть. Для повторного полного прогона нужен свежий limiter/изолированное окружение; сохранённые записи различаются уникальными маркерами. Не очищайте общую БД.

E2E проверяет реальные intake/moderation/vote/duplicate/spam/logout, отсутствие приватных маркеров в публичном JSON, минимальный bug payload, safe source/version, retained draft после прерванного сетевого запроса, независимость critical priority и sparse information, мобильный overflow, keyboard dialog focus и axe WCAG A/AA. Единственный перехват сети — `route.abort` для проверки настоящего отказа, успешные ответы никогда не подменяются. Пагинация проверяется unit-тестом границ, UI поддерживает реальные большие списки без обхода submit budget для искусственного заполнения.

Playwright не скачивает браузер автоматически. Config выбирает установленный Chromium, иначе Firefox; можно задать `PLAYWRIGHT_BROWSER=firefox|chromium|webkit` и `PLAYWRIGHT_EXECUTABLE_PATH`. На этой машине найден совместимый Firefox в `~/.cache/ms-playwright/firefox-1555/firefox/firefox`; Chromium отсутствовал. В CI нужны соответствующий Playwright browser и системные зависимости (на Linux Firefox требует GTK, libdbus, X11/GBM и т.п.). Установку выполняйте отдельно средствами CI, с обычным дисковым `PLAYWRIGHT_BROWSERS_PATH`, не `/tmp`.

Trace/video/автоматические скриншоты отключены: они могут записать пароль или приватные сообщения. Тестовые артефакты не коммитятся. Unit-тесты используют mock fetch только для отказов транспорта и проверки заголовков; приложение всегда обращается к реальному API.

## Проверки этой реализации

- `pnpm test`: 31 тест, 3 файла — успешно.
- `pnpm build`: typecheck и Vite production build — успешно.
- Read-only `tests/public.spec.ts`: Firefox, 1 passed; реальные GET API, light/dark axe WCAG A/AA, keyboard skip link, 320/390/1280 px без overflow. Запуск на актуальном Vite с временным QA Host-proxy к Docker API (его canonical Host отличается от Vite origin); продуктовая config не менялась. Визуально проверены screenshots мобильной формы и desktop-доски.
- Реальный мутационный `tests/app.spec.ts` — lead сообщил PASS по `.local/e2e-run.log`: intake, retained network-error draft, moderation, votes, duplicates, spam. После этого исправлена найденная в public smoke CSS-ошибка dark anchor button: обычные `a`/`a:hover` исключают `.u-button`, сохраняя семантический accent-ink библиотеки. Подтверждены computed цвета dark normal/hover и повторный axe без исключений. Финальный совместный E2E-прогон на свежем backend остаётся частью root integration.

Финальная интеграция выполнена: **2/2 Firefox E2E PASS** на настоящем Go1.27.3/PostgreSQL, включая coarse-pointer16px, внутреннюю ширину admin-dialog320px и сохранение dirty note при отмене Escape. Независимое [Application/UX R2](../docs/review-application-ux-r2.md) закрыло все замечания; пять свежих axe-сканов без нарушений. Общие результаты и границы — [validation](../docs/validation.md).

Дополнения к общему контракту, которые стоит зафиксировать владельцу `docs/`: текущие серверные пределы title 160 / description 5000 / details 8000 / admin_note 8000 / app_version 40; UI им соответствует. Необязательность `details/context` и нейтральная квитанция соблюдаются. Отдельный машинный код `form_token_expired` в будущей версии был бы надёжнее распознавания текущего русского сообщения; клиент уже распознаёт реальную фразу «Срок действия формы истёк…».

## Компактный интерфейс — 2026-10-21

Доска начинается с предложений, единой кнопки «Написать» и фильтров. Hero, sidebar, повторные призывы и рекламный footer удалены. Одна форма переключается между предложением и ошибкой; внешние ссылки с `project` / `type=bug` продолжают работать.

Использованы реальные опубликованные `unlikely-ui/physical-button` и `unlikely-ui/popover`, проверены их установленные `.d.ts` и реализация. PhysicalButton служит компактным переключателем голоса (`aria-pressed`, `aria-busy`), цвета заданы через `colors` и семантические токены; компонент не скопирован. Размер адаптирован через его CSS-переменную, без CSS transform масштабирования touch target. Справка — Popover с кнопкой закрытия и возвратом фокуса. Выбранный/активный пункт Select получает фон до краёв через scoped `.hub-select-popup`, без изменения библиотеки.

[Логотип, prompt и происхождение favicon](../docs/assets/feedback-bulb.md). Иконки загружаются локально, внешние ссылки проверяются на http(s). DELETE голоса не повторяется автоматически и обновляет интерфейс только после серверного ответа; при сетевой ошибке состояние сохраняется.
