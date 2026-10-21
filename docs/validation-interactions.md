# Уточнение интерфейса — 2026-10-21

Изменения относительно [редизайна](validation-redesign.md): кнопка 72px вместо 60px, независимые запросы карточек, иконки в Select и загрузка через Skeleton. Серверный код и зависимости не менялись. Production/VPS/DNS не затронуты.

## Реализация

Busy/error/in-flight guard принадлежат отдельной `memo(FeatureCard)`. Общего `otherVoting` больше нет. Stable callback и `useResource.updateData` сохраняют ссылки неизменившихся предложений; карточки не получают новые inline callbacks. Первичная visitor-cookie получается через один общий Promise при параллельных нажатиях. Ответ сервера обновляет только нужную запись; автоматических повторов и оптимистического подсчёта нет. `focusableWhenDisabled` сохраняет фокус на занятой кнопке.

Иконки локальны и единообразны на доске, в форме и admin picker. Строковые labels сохранены для typeahead; `Select.Value` использует публичный render callback. Начальный каталог показывает `BoardSkeleton`, списки — Skeleton-карточки, прочий контент — текстовые Skeleton; нет отдельного Spinner и искусственной задержки. Skeleton скрыты от accessibility tree, loading status объявлен отдельно.

## Фактические проверки

- `scripts/check.sh`: PASS — Go vet/race/PostgreSQL suite (неизменившийся backend, cache), TypeScript, 31 frontend unit, Vite build.
- Полный Firefox E2E: **3/3 PASS**, затем повтор после добавления сохранения фокуса — **3/3 PASS**.
- В реальной PostgreSQL одобрены два уже созданных тестовых предложения. Исходящий запрос первого голоса задержан транспортом, ответ второго пришёл независимо. Вторая кнопка осталась тем же DOM-узлом с неизменным outerHTML и была доступна. Фокус на первой сохранялся; undo, reload, re-vote и ошибка сети также прошли. Успешные mutation-ответы не подменялись, intake по-прежнему создаёт только три обращения.
- Начальные GET каталога/списка задерживались по отдельности, проверены оба Skeleton-состояния и их исчезновение при настоящем ответе. В меню и выбранном значении проверены src, видимость и загрузка favicon. Public keyboard/theme/axe и 320px overflow checks — PASS.
- Реальные screenshots320/390/1280: горизонтального overflow нет, page errors нет. Размер target72×92px; первая мобильная карточка по-прежнему начинается на y=299px. Скриншоты меню и начальной загрузки просмотрены, артефакты в ignored `.local/screenshots`.
- Docker build/start/readiness: PASS. На обновлённом `localhost:18080` повторены два public E2E-сценария.

Проверка защиты по текущему коду и примеры: [abuse-controls.md](abuse-controls.md). Token buckets находятся в памяти и сбрасываются при рестарте; admission-квоты и vote cooldown сохраняются в БД. CAPTCHA/автоматической смысловой классификации нет, модерация ручная. Внешний anti-DDoS в этом обновлении не подключался.

## Независимое ревью

[Interaction UX R1](review-interactions-r1.md), commit `ce169a8`: блокеров и actionable regressions нет; 41 axe-скан без нарушений. Проверены актуальная правка фокуса, стабильные props/fiber и DOM соседних карточек, совместный visitor bootstrap, восстановление после ошибки, typeahead и оба состояния Skeleton. Ревью использует отдельно обозначенные GET-фикстуры и перехваченные/отменённые POST, а реальные мутации подтверждены E2E лидера.

## Локальный deploy-артефакт

`feedback-hub:2026-10-21-3` (также `local`), image ID `sha256:6a97e2ca050a18086c257a22e36f067339e5da411094e7c5c858b0765ebd6f1c`.

`.local/feedback-hub-2026-10-21-3.tar.gz`, 7.9MiB, SHA256 `14e38a10252e7992cac132e0311131aafd97cd2d7ca03d51c71c4090768bfde7`. Runtime-секреты не включены. JS147.18KB gzip, CSS10.89KB gzip.

Firefox/axe и синтетические данные не означают сертификацию Safari, физических устройств, screen reader или production-нагрузки.
