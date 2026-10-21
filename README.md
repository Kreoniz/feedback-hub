# Feedback Hub

Единая обратная связь для проектов Kreoniz: публичные предложения с голосованием и приватные сообщения об ошибках. Русский интерфейс, мобильная админка, без регистрации посетителей.

React 19 / TypeScript / Vite / [Unlikely UI](https://www.npmjs.com/package/unlikely-ui), Go `net/http`, PostgreSQL 18. Один Go-процесс отдаёт SPA и API. Репозиторий: [Kreoniz/feedback-hub](https://github.com/Kreoniz/feedback-hub) (приватный).

## Запуск

Нужны Docker Engine + Compose, Python 3, curl. Скрипт собирает приложение, создаёт случайные локальные credentials, применяет миграции и запускает PostgreSQL, приложение и Caddy:

```sh
./scripts/local-up.sh
```

Открыть **http://localhost:18080**, админка **http://localhost:18080/admin**. Пароль: `cat .local/admin-password`. Пароль не выводится в журналы, default credentials отсутствуют. Используйте именно `localhost`: приложение проверяет Host и Origin. Конфигурация хранится в ignored `.env`, секреты — в `.local/secrets/`. Каталоги защищены `0700`; отдельные смонтированные файлы читаются non-root контейнерами. На Fedora mounts имеют SELinux labels. Скрипт сохраняет существующие секреты и данные.

```sh
docker compose ps
docker compose logs --tail=50 app
docker compose stop
docker compose up -d
./scripts/backup.sh
```

`docker compose down` сохраняет БД. `down -v` **удаляет данные**. Не используйте эту команду для обновления. Резервные копии содержат приватные обращения; храните их вне Git и копируйте в защищённое внешнее хранилище.

## Разработка

Версии инструментов закреплены в `mise.toml`, npm-пакетов — в `web/package.json` и lockfile. Опубликованная `unlikely-ui@0.1.0-alpha.1` используется через публичные subpath exports и semantic tokens; неопубликованные компоненты не импортируются. Node/pnpm нужны только при сборке.

```sh
mise trust
mise install
pnpm --dir web install --frozen-lockfile
./scripts/build.sh
./scripts/check.sh
```

Для frontend hot reload: запустить API на `127.0.0.1:18080` с `APP_ORIGIN=http://localhost:5173`, затем `pnpm --dir web dev`. Точный Vite proxy указан в `web/vite.config.ts`. Для обычных E2E собранную SPA отдаёт Go на порту 18080. Конфигурация и CLI: [backend/README.md](backend/README.md), frontend и браузерные тесты: [web/README.md](web/README.md).

Интеграционные тесты требуют **отдельную одноразовую БД**, не production:

```sh
export DATABASE_URL_TEST='postgres://test_user:test_password@localhost:5432/feedback_test?sslmode=disable'
./scripts/check.sh
pnpm --dir web exec playwright install --with-deps firefox
./scripts/test-e2e.sh
```

PostgreSQL-тесты создают/чистят собственные fixtures; URL должен указывать только на тестовую БД. `scripts/test-e2e.sh` запускает настоящий Go API, использует случайный тестовый admin-пароль и завершает процесс после тестов. Логи/артефакты остаются в ignored `.local` и `web/test-results`. CI запускает Go vet/race, TypeScript, unit, PostgreSQL, Playwright и Docker build. Результаты конкретной проверки — в [docs/validation.md](docs/validation.md).

## Подключение проектов

Обычная ссылка не требует SDK или доступа к cookies проекта:

```html
<a href="https://feedback.kreoniz.ru/new?project=campus&type=bug"
   target="_blank" rel="noopener noreferrer">Сообщить об ошибке</a>
```

Для предложения — `type=feature`. Начальные проекты: `campus`, `unlikely-ui`, `other`. Явный `project` имеет приоритет; автоматическое определение источника использует только известные origins. Не передавайте в ссылках email, tokens, query исходной страницы или данные пользователя. Допустимый контекст и точный способ передачи версии описаны в frontend README. Query/fragment/userinfo повторно отбрасываются сервером. Неизвестный проект не принимается API.

Новый проект добавляется в серверный каталог проектов, allowlist идентификаторов frontend и SQL CHECK через контролируемую миграцию в `backend/internal/store/migrations/`. Канонический URL сервера служит allowlist для определения источника. Slug — публичный идентификатор, не секрет и не средство авторизации.

## Безопасность и границы MVP

Баги, подробности, browser context и заметки доступны только владельцу. Предложения по умолчанию ожидают модерации. Публичное API выбирает отдельный набор безопасных полей. Приоритет задаёт администратор независимо от информативности.

Сервер ограничивает запросы, отправку, голосование и вход; проверяет размеры, типы и значения; использует honeypot и подписанный временной токен. Повторы обращений дедуплицируются. Голосование идемпотентно, защищено уникальностью в БД, подписанной visitor-cookie и сетевым ограничением. Это снижает простую накрутку, но не доказывает уникальность человека. Общий NAT может ограничить разных посетителей; распределённые IP обходят часть ограничений. CAPTCHA и регистрация не нужны для штатного сценария.

Админ: bcrypt-пароль, случайные серверные сессии, HttpOnly/SameSite cookie, Secure в production, Origin и CSRF-проверки. Текст выводится без HTML/Markdown исполнения; CSP ограничивает загрузки. Приложение не получает URL из контекста по сети и не собирает содержимое страниц, storage или cookies исходного проекта. Сырые IP и содержимое обращений не пишутся в журналы. Forwarded IP доверяется только явно заданному единственному proxy-hop. Лимиты Go/Caddy защищают ресурсы приложения; сетевой DDoS требует провайдера/внешнего edge. Подробности: [исследование](docs/research.md), [архитектура](docs/architecture.md), [API](docs/contract.md).

## VPS

Целевой домен **feedback.kreoniz.ru**. Готовы [production Compose](deploy/compose.production.yaml), [фрагмент Caddy](deploy/Caddyfile.production) и [runbook](docs/deployment.md). Предполагается существующий Caddy в общей Docker-сети. Сборку выполнять локально/в CI, на VPS переносить готовый образ. **Production не развёрнут; DNS и работающие сервисы не изменены.** Применение к общей инфраструктуре — отдельный разрешённый шаг.

Telegram, GitHub Issues, вложения, комментарии, аккаунты посетителей и автоматическая LLM-классификация отложены. При добавлении уведомлений понадобится транзакционный outbox; сейчас отдельная очередь и интеграционные абстракции не нужны.
