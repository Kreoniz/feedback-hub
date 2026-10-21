# Проверка MVP — 2026-10-21

После исходного MVP выполнены [редизайн и отмена голосов](validation-redesign.md), затем [уточнение взаимодействий](validation-interactions.md); в последнем отчёте актуальный runtime-образ и проверки. Ниже сохранены исходные результаты.

Проверено локально на Fedora, на синтетических данных. Production, DNS и общий VPS Caddy не менялись. Код: [приватный репозиторий](https://github.com/Kreoniz/feedback-hub).

## Итоговые проверки

| Проверка | Результат |
| --- | --- |
| Go1.27.3 unit, HTTP и PostgreSQL integration, race detector | PASS; тесты работают в отдельных временных схемах |
| Go vet, gofmt, TypeScript | PASS |
| Frontend unit | 31/31 PASS, 3 файла |
| Vite production build | PASS |
| Firefox E2E с настоящим Go API/PostgreSQL | 2/2 PASS; без подмены успешных mutation-ответов |
| Независимый black-box acceptance через Docker/Caddy | 29/29 PASS на итоговом образе |
| Мобильные экраны | 320/390px, desktop1280/1440px; проверены размеры внутреннего admin-dialog и фокус |
| Accessibility | axe WCAG A/AA; светлая/тёмная темы, формы, вложенные select, dialogs; финальное независимое R2 — 5 сканов без нарушений |
| Production npm audit | 0 известных уязвимостей production-зависимостей на дату проверки |
| govulncheck v1.9.0 | 0 достижимых уязвимостей на Go1.27.3; 1 advisory в невызываемом коде required-модулей |
| App и hardened Caddy Docker build | PASS |
| Local и production Compose/Caddy syntax | PASS |
| Caddy error logger при настоящем 502 | PASS: без client_ip/remote_ip, URL, headers, cookie |
| pg_dump → отдельная restore DB → следующие записи → новый backup → вторая restore DB | PASS: обращения/голоса сохранены, post-restore marker включён |
| Backup target selection | pgx CLI учитывает dbname/database; неподдерживаемые host/port/user и неоднозначные имена отвергаются до dump |
| PostgreSQL app-role | NOSUPERUSER, NOCREATEDB, NOCREATEROLE подтверждены |
| GitHub Actions | workflow настроен; runner не стартовал из-за billing/spending limit аккаунта |

CI-сбой: [run39567059571](https://github.com/Kreoniz/feedback-hub/actions/runs/39567059571). GitHub сообщил отказ до выполнения шагов из-за оплаты/spending limit; это **не успешный CI-прогон**. Основные команды workflow выполнены локально. Настройки оплаты не менялись.

Проверенный runtime image: `feedback-hub:2026-10-21-1` (также local), digest `sha256:57282d5190919a40927eaddabd4fe3f939add368b57af9aa5859d68031e7fe65`. Архив `.local/feedback-hub-2026-10-21-1.tar.gz`, 7.9MiB, SHA256 `8233957310467c790c9602ad0587b513650b2a604cf695980f0cebe90722eba0`, без runtime-секретов. Node24.22.0, pnpm12.5.1, Go1.27.3, PostgreSQL18.6, Caddy2.11.4, React19.3.1, `unlikely-ui@0.1.0-alpha.1`. Сжатые размеры сборки: JS139.18KB, CSS10.88KB — оценки Vite gzip, не замер production Core Web Vitals.

Локальный стек доступен на `http://localhost:18080`, только loopback. На нём есть синтетические обращения приёмки; новых пользовательских данных не было. Пароль владельца — ignored `.local/admin-password`, здесь не публикуется.

## Реальные сценарии

Анонимный баг отправляется без title/контакта. Details скрыты; browser family, безопасный source URL и release label собираются автоматически, их можно отключить. Query/fragment/идентификаторы пути отбрасываются. Сбой сети сохраняет текст во вкладке, успешный повтор пишет настоящую БД.

Предложение отсутствует на публичной доске до одобрения. Администратор видит точный публичный preview, меняет priority/status/information независимо, связывает дубликаты и отмечает spam. Проверена комбинация `critical`+`sparse`. Bug нельзя одобрить даже прямым PATCH. Details/context/notes и их поисковые совпадения не видны публично.

Одинаковые голоса одного visitor, включая конкурентные запросы, считаются один раз. Немедленная смена cookie из той же сети встречает минутный cooldown. Смена cookie вне окна, другой браузер и распределённые IP могут добавить голоса — уникальность человека не обещается. Поддельный XFF не обходит лимит через Caddy.

Чужие Origin, отсутствие CSRF, неавторизованная админка, чрезмерный/неверный JSON, злоупотребления и honeypot проверены. Приватная дедупликация не раскрывает cross-visitor совпадения через границы project/day, global/day и lifetime квот. Повтор после24ч или завершения предыдущего обращения создаёт новую запись. Приватные заметки ищутся только в admin API.

Сохранность dirty admin note проверена при Escape и отмене discard. На320px фокус Save не вызывает внутреннего горизонтального скролла, поля при coarse pointer имеют16px. Пагинация переводит фокус на стабильный results landmark.

## Независимые ревью и исправления

- [Архитектурный скептик](skeptic-architecture.md): B1–B10, privacy/proxy/auth/storage/cache и инфраструктурные границы.
- [Application R1](review-application-r1.md): квотная утечка cross-visitor дедупликации и несоответствие поиска заметок; исправлены visitor-scoped dedupe и отдельным admin search predicate.
- [UX R1](review-ux-r1.md): внутренний overflow модального окна320px, потеря dirty draft, фокуса пагинации и coarse typography; исправлены и добавлены реальные регрессионные проверки.
- [Application/UX R2](review-application-ux-r2.md): A1/A2 и UX R1–R4 закрыты, остаточных blockers не найдено.
- [Infrastructure R1](review-infrastructure-r1.md), [R2](review-infrastructure-r2.md) и [backup R3](review-backup-r3.md): backup после restore, client_ip в error log, configured port, concurrent backups, CI ingress checks и неоднозначные URL. Итоговое решение использует pgx CLI вместо отдельного URL parser; restore-регрессия проверяет эффективный выбор и явные отказы.
- [Backup R4](review-backup-r4.md): R1/F1/F2 закрыты. Независимый restore сохранил marker для path и обоих query aliases; оба F2 URL и10 других неверных targets отвергнуты до dump. Все10 CLI tests PASS. После добавления CLI повторены Docker build/start, CLI race и Go vet; новых HTTP/UI изменений не было.

При проверке зависимостей найден GO-2026-6809 в Go1.27.2; toolchain/CI/Docker обновлены до1.27.3, затем race/integration/build и govulncheck повторены.

Артефакты исполнения и синтетические screenshots находятся в ignored `.local/`; в Git сохранены тесты, команды и отчёты, без credentials и обращений. T3 preview дважды завершился `Preview automation snapshot timed out after 15000ms.`; визуальная проверка выполнена документированным Playwright/Firefox, screenshots просмотрены.

## Границы проверки и следующие версии

Не проверялись физический iPhone/Safari, screen reader, public HTTPS/production cookies на реальном домене, offsite delivery, длительное нагрузочное тестирование/50k worst-case, Core Web Vitals и volumetric DDoS. Caddy/Go limits не заменяют L3/L4 mitigation и внешний L7 edge. Перед разрешённым деплоем нужны фактический Caddy IP, свободные ресурсы, ingress deadlines/log policy, защищённый offsite backup и HTTPS smoke по runbook.

Одна replica, лимитированная storage/admission модель, manual retention. Backup-скрипт обслуживает только локальную Compose PostgreSQL; иная топология требует отдельного проверенного процесса. Канонический URL Unlikely UI пока не подтверждён: explicit `project=unlikely-ui` работает, автоматическая source inference доступна для известного Campus origin.

Отложены Telegram/GitHub Issues (позже transactional outbox), вложения/комментарии, посетительские аккаунты, public-text redaction workflow, UI управления каталогом проектов, измеренное route splitting и централизованная edge-миграция. Сначала важнее получить реальную обратную связь и измерить нагрузку/ложные ограничения.
