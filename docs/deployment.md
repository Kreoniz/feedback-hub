# Развёртывание на VPS

Подготовленный runbook, **не акт деплоя**. DNS, Caddy, firewall и VPS в этой задаче не менялись.

## Подготовка

Сохранённый инфраструктурный контекст указывает на `vdsina-ru`, общий контейнер Caddy `beszel-proxy-caddy-1`, сеть `beszel-edge`, bind-mounted `/etc/beszel-proxy/Caddyfile`. Это датированный контекст, его нужно сверить узко перед применением. На VPS примерно 2 ГБ RAM; собирать Node/Go образы лучше локально или в CI. Заложить 500–650 МБ RAM для нового стека и запас диска для БД/backup. Существующие сервисы не останавливать.

1. Получить явное разрешение на конкретный деплой/изменение DNS и общего Caddy.
2. Проверить свободные ресурсы, фактическую Docker-сеть и IP Caddy **в ней**, существующие маршруты и backup общего Caddy. Не выводить env/logs других сервисов.
3. Собрать и проверить образ локально, дать уникальный tag. Пример:

```sh
docker build -t feedback-hub:2026-10-21-4 .
# Архив большой: хранить на диске под home, не в RAM-backed /tmp.
docker save feedback-hub:2026-10-21-4 | gzip > .local/feedback-hub-2026-10-21-4.tar.gz
```

Перенести репозиторий без `.local`, `.env`, `.git` и образ на выбранный VPS по утверждённому каналу; загрузить `docker load`. Разместить приложение отдельно, например `/opt/feedback-hub`. Не копировать локальные тестовые данные и секреты в production.

## Конфигурация

На целевом хосте после загрузки образа:

```sh
FEEDBACK_IMAGE=feedback-hub:2026-10-21-4 ./scripts/init-env.sh production
```

Скрипт создаёт новые случайные credentials в `.local`, защищает каталоги `0700`. Пароль владельца — `.local/admin-password`; доставлять его владельцу приватно, не в чат/logs. Перед первым запуском отредактировать `.env`:

- `SECRET_DIRECTORY`: абсолютный путь к production `.local/secrets`.
- `FEEDBACK_IMAGE`: точный проверенный tag, например `feedback-hub:2026-10-21-4`.
- `EDGE_NETWORK`: существующая сеть общего Caddy.
- `TRUSTED_PROXIES`: только фактический Caddy peer IP `/32` (или `/128`). Placeholder обязательно заменить. При пересоздании Caddy IP может измениться: закрепить его штатным способом либо обновить только этот параметр после проверки.

Production Compose жёстко задаёт `DEVELOPMENT=false` и HTTPS-origin. Параметры `.env` локального запуска не включают HTTP в production. Compose secret-файлы — обычные bind mounts, не encrypted secret manager. App получает только нужные три файла, DB — два своих пароля. Файлы `0444` защищены каталогом `0700`, что позволяет читать mounts UID10001. Не открывайте родительский каталог.

```sh
docker compose --env-file .env -f deploy/compose.production.yaml config --quiet
docker compose --env-file .env -f deploy/compose.production.yaml up -d --wait
docker compose --env-file .env -f deploy/compose.production.yaml exec -T app \
  wget -qO- http://127.0.0.1:8080/health/ready
```

PostgreSQL volume смонтирован в `/var/lib/postgresql` по контракту официального образа 18+. Init создаёт отдельную ограниченную роль `feedback`; приложение не использует PostgreSQL superuser. Миграции встроены и автоматически применяются перед listen. Не менять major PostgreSQL простым изменением tag.

## Caddy и DNS

Добавить **только** site block из `deploy/Caddyfile.production` в существующий конфиг. Не заменять общий Caddyfile. Если файл bind-mounted отдельно, сохранить inode при записи по действующему runbook. Проверить Caddy `validate` до `reload`, затем здоровье существующих маршрутов. Не добавлять stock Caddy `rate_limit`: такого встроенного модуля нет, лимиты реализованы в Go.

Перед публикацией обязательно проверить эффективные inbound header/body/read/write/idle timeouts общего Caddy по примеру `deploy/Caddyfile.local`; согласовать совместимую настройку для соседних сайтов. Error logs должны удалять request URI/headers и **оба** поля адреса `remote_ip`/`client_ip`; access logs для нового сервиса не включать. Подтвердить это синтетической ошибкой upstream без приватных данных. CSP и прочие защитные заголовки выставляет Go. Health закрыт production Caddy.

DNS направить на утверждённую точку ingress после выбора сетевой защиты. При текущем прямом доступе Caddy сам получает HTTPS certificate. Не проксировать через Cloudflare по умолчанию: российские пользователи имеют подтверждённые риски доступности; [исследование](research.md) рассматривает альтернативы. При external reverse proxy закрыть обход origin на уровне ingress/firewall, предусмотреть ACME/DNS certificate validation, проверенные source ranges и отдельный корректный контракт client IP. Сначала согласовать это централизованно для домена.

После публикации проверить HTTPS, `/`, `/new?project=campus&type=bug`, admin login/logout, private bug isolation, moderation, vote retry, мобильный экран, secure cookies и заголовки. Проверять только синтетическими данными; удалить fixtures через контролируемую SQL-операцию после проверки. Не считать `healthy` заменой приёмки.

## Backup, restore и обновления

```sh
./scripts/backup.sh --production
```

Custom-format `pg_dump` атомарно сохраняется с уникальным именем в `.local/backups` с правами `0600`, проверяется `pg_restore --list`. Перед остановкой app выполнить backup: скрипту нужен работающий контейнер app. Его read-only CLI `backup-target` использует **тот же pgx parser**, что сервер, и выводит только проверенное эффективное имя БД, без credentials. Поэтому `dbname`/`database` query aliases учитываются правильно. Поддерживается **только локальный Compose PostgreSQL**: effective host `db`, port5432, role `feedback`, имя `[A-Za-z_][A-Za-z0-9_-]{0,62}`. Другие хосты/порты/роли, альтернативные hosts и нестандартные имена (включая slash/fragment) приводят к отказу **до staging/dump**. Для другой топологии или недоступного контейнера app нужен отдельный проверенный операторский backup-процесс; нельзя угадывать БД по URL path. Регулярно делать restore smoke в **новую отдельную БД**, сверять обращения/голоса, записать синтетическую строку после переключения и проверить её в **следующем backup**. Пароли/секрет подписи сохранять отдельно защищённо. Скопировать backup на независимый носитель; автоматический offsite timer требует настройки владельца.

Для restore: остановить только app, сохранить текущую БД и образ, восстановить dump в **новую** БД через `pg_restore --no-owner --role=feedback`, сверить таблицы/ограничения, затем переключить URL path в `database_url` и **пересоздать только app** (`up -d --force-recreate app` с production Compose/env flags). Это обязательно после атомарной замены URL-файла: прежний bind mount может держать старый inode; простой restart/start недостаточен. Не выполнять `--clean` на работающей production БД. Команда требует роли `feedback`, созданной init-скриптом. Бинарник нового релиза не должен откатывать миграции автоматически.

Обновление: backup → новый image tag → запуск app → readiness и smoke → сохранить предыдущий образ. При несовместимой миграции rollback приложения требует отдельного плана, а не слепого восстановления старой БД с потерей новых сообщений. `down -v`, `docker system prune` и остановка общего Caddy не входят в обновление.

## Восстановление доступа

Новый длинный пароль передать `hash-password` через stdin из защищённого файла и атомарно заменить `admin_hash` **с учётом bind-mounted inode**: пересоздать только app, чтобы новый mount прочитал новый файл. Для немедленного отзыва удалить все admin sessions контролируемой SQL-командой (`DELETE FROM sessions`, точное имя сверить с migration). Ротация `app_secret` сбрасывает visitor proofs/сетевые идентификаторы; проводить осознанно, сохраняя прежний ключ приватно для rollback. Не публиковать cookies/hash/пароли при диагностике.

Первичные контракты: [PostgreSQL Docker image](https://hub.docker.com/_/postgres), [Caddy reverse proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy), [Caddy global options](https://caddyserver.com/docs/caddyfile/options), [Compose secrets](https://docs.docker.com/compose/how-tos/use-secrets/). Проверены 2026-10-21.
