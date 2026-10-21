import { useCallback, useEffect, useState } from "react";
import { Badge } from "unlikely-ui/badge";
import { Button } from "unlikely-ui/button";
import { Card } from "unlikely-ui/card";
import { Dialog } from "unlikely-ui/dialog";
import { Input } from "unlikely-ui/input";
import { api, ApiError, errorMessage } from "./api";
import { dateLabel, listQuery, options, statusLabels } from "./domain";
import type { Feature, Project } from "./domain";
import { useFilters, usePaginationFocus, useResource, useSearch } from "./hooks";
import {
  EmptyState,
  ErrorNotice,
  FormField,
  Icon,
  Loading,
  Pagination,
  SelectField,
  StatusBadge,
} from "./ui";

export function Board({ projects }: { projects: Project[] }) {
  const [filters, update] = useFilters(
    ["project", "q", "status", "sort", "offset"],
    "votes",
  );
  const query = listQuery(filters, "votes");
  const load = useCallback(
    (signal: AbortSignal) => api.features(query, signal),
    [query],
  );
  const resource = useResource(load);
  const searchChange = useCallback(
    (q: string) => update({ q }, true),
    [update],
  );
  const [search, setSearch] = useSearch(filters.q, searchChange);
  const [voteError, setVoteError] = useState("");
  const [voting, setVoting] = useState<string | null>(null);
  const [visitorReady, setVisitorReady] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    api.form(controller.signal).then(
      () => setVisitorReady(true),
      () => {},
    );
    return () => controller.abort();
  }, []);
  async function vote(feature: Feature) {
    if (voting || feature.voted) return;
    setVoting(feature.id);
    setVoteError("");
    try {
      if (!visitorReady) {
        await api.form();
        setVisitorReady(true);
      }
      const result = await api.vote(feature.id);
      resource.updateData((data) =>
        data
          ? {
              ...data,
              items: data.items.map((item) =>
                item.id === feature.id ? { ...item, ...result } : item,
              ),
            }
          : data,
      );
      setAnnouncement(`Вы поддержали идею «${feature.title}».`);
    } catch (error) {
      setVoteError(errorMessage(error));
    } finally {
      setVoting(null);
    }
  }
  const filtered = !!(filters.project || filters.q || filters.status);
  const offset = Number(new URLSearchParams(query).get("offset"));
  const resultsHeading = usePaginationFocus<HTMLHeadingElement>(offset);
  return (
    <>
      <section className="hero">
        <div>
          <p className="eyebrow">ОБРАТНАЯ СВЯЗЬ</p>
          <h1>
            Что улучшить дальше<span className="accent-text">?</span>
          </h1>
          <p className="lead">
            Хорошие идеи приходят от тех, кто пользуется проектом.
            <br className="desktop-break" /> Предлагайте улучшения и
            поддерживайте нужные вам.
          </p>
        </div>
        <Button
          size="lg"
          render={
            <a
              href={`/new${filters.project ? `?project=${encodeURIComponent(filters.project)}` : ""}`}
            />
          }
          nativeButton={false}
        >
          <Icon name="plus" />
          Предложить идею
        </Button>
      </section>
      <div className="board-layout">
        <section className="board-main" aria-label="Доска идей">
          <div className="section-heading">
            <h2 ref={resultsHeading} tabIndex={-1}>Доска идей</h2>
            <Badge tone="neutral">Публично</Badge>
          </div>
          <div className="filter-panel">
            <div className="search-field">
              <FormField label="Поиск идей" name="q">
                <div className="search-input">
                  <Icon name="search" />
                  <Input
                    type="search"
                    value={search}
                    onValueChange={setSearch}
                    placeholder="Что хочется улучшить?"
                    maxLength={200}
                  />
                </div>
              </FormField>
            </div>
            <SelectField
              label="Проект"
              name="project"
              value={filters.project}
              onChange={(project) => update({ project })}
              items={[
                { value: "", label: "Все проекты" },
                ...projects.map((p) => ({ value: p.slug, label: p.name })),
              ]}
            />
            <SelectField
              label="Статус"
              name="status"
              value={filters.status}
              onChange={(status) => update({ status })}
              items={[
                { value: "", label: "Все статусы" },
                ...options(statusLabels),
              ]}
            />
            <SelectField
              label="Порядок"
              name="sort"
              value={filters.sort}
              onChange={(sort) => update({ sort })}
              items={[
                { value: "votes", label: "Популярные" },
                { value: "new", label: "Сначала новые" },
              ]}
            />
          </div>
          <div className="list-heading">
            <p className="muted" aria-live="polite">
              {resource.loading
                ? "Ищем идеи…"
                : resource.data
                  ? `Найдено: ${resource.data.total}`
                  : "Не удалось обновить список"}
            </p>
            {filtered && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  update({ project: "", q: "", status: "", offset: "" })
                }
              >
                Сбросить
                <Icon name="close" />
              </Button>
            )}
          </div>
          {voteError && (
            <ErrorNotice
              error={new ApiError(voteError)}
              title="Не удалось добавить голос"
            />
          )}
          <div className="sr-only" role="status">
            {announcement}
          </div>
          {resource.loading ? (
            <Loading cards label="Загружаем идеи" />
          ) : resource.error ? (
            <ErrorNotice error={resource.error} retry={resource.reload} />
          ) : (
            resource.data && (
              <>
                {!resource.data.items.length ? (
                  <EmptyState
                    filtered={filtered || !!offset}
                    reset={() =>
                      update({ project: "", q: "", status: "", offset: "" })
                    }
                  />
                ) : (
                  <ul className="feature-list">
                    {resource.data.items.map((feature) => (
                      <li key={feature.id}>
                        <FeatureCard
                          feature={feature}
                          vote={() => vote(feature)}
                          voting={voting === feature.id}
                          otherVoting={!!voting}
                          error={voteError}
                        />
                      </li>
                    ))}
                  </ul>
                )}
                <Pagination
                  offset={offset}
                  total={resource.data.total}
                  onChange={(offset) => update({ offset })}
                />
              </>
            )
          )}
        </section>
        <aside className="board-aside">
          <Card.Root className="how-card">
            <p className="eyebrow">МАЛЕНЬКИЙ ВКЛАД</p>
            <h2>
              Ваш голос
              <br /> помогает выбрать.
            </h2>
            <p>
              Поддержите идею, если она пригодится и вам. Мы учитываем голоса,
              когда планируем улучшения.
            </p>
            <div className="aside-rule" />
            <p className="small">
              Идеи появляются после проверки. Голоса не равны числу уникальных
              людей. Общая сеть может временно задержать голос.
            </p>
            <details className="vote-privacy">
              <summary>Как устроено голосование</summary>
              <p>
                Cookie посетителя действует 365 дней: один голос за идею с
                выданного идентификатора. В общей сети новый голос за ту же идею
                может быть доступен через 60 секунд. Сброс cookie или другой
                браузер после паузы позволяют проголосовать снова. Регистрация
                не нужна.
              </p>
            </details>
          </Card.Root>
          <div className="bug-note">
            <Icon name="message" />
            <h2>Что-то не работает?</h2>
            <p>Расскажите об ошибке. Сообщение увидит только администратор.</p>
            <a
              href={`/new?type=bug${filters.project ? `&project=${encodeURIComponent(filters.project)}` : ""}`}
            >
              Сообщить об ошибке
              <Icon name="arrow" />
            </a>
          </div>
        </aside>
      </div>
    </>
  );
}

function FeatureCard({
  feature,
  vote,
  voting,
  otherVoting,
  error,
}: {
  feature: Feature;
  vote: () => void;
  voting: boolean;
  otherVoting: boolean;
  error: string;
}) {
  return (
    <Card.Root className="feature-card">
      <Button
        className="vote-button"
        variant={feature.voted ? "primary" : "secondary"}
        aria-label={`${feature.voted ? "Вы поддержали" : "Поддержать"}: ${feature.title}. Голосов: ${feature.votes}`}
        aria-pressed={feature.voted}
        disabled={feature.voted || otherVoting}
        loading={voting}
        onClick={vote}
      >
        <Icon name={feature.voted ? "check" : "up"} />
        <span>{feature.votes}</span>
      </Button>
      <div className="feature-body">
        <div className="card-meta">
          <span>{feature.project_name}</span>
          <span aria-hidden="true">·</span>
          <time dateTime={feature.created_at}>
            {dateLabel(feature.created_at)}
          </time>
        </div>
        <Dialog.Root>
          <h3>
            <Dialog.Trigger
              render={<Button variant="ghost" className="feature-title" />}
            >
              {feature.title}
            </Dialog.Trigger>
          </h3>
          <p className="feature-preview">{feature.description}</p>
          <div className="feature-footer">
            <StatusBadge status={feature.status} />
          </div>
          <Dialog.Content className="idea-dialog">
            <div className="dialog-heading">
              <Badge>{feature.project_name}</Badge>
              <Dialog.Close
                render={
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Закрыть идею"
                  />
                }
              >
                <Icon name="close" />
              </Dialog.Close>
            </div>
            <Dialog.Title>{feature.title}</Dialog.Title>
            <Dialog.Description>
              Идея опубликована {dateLabel(feature.created_at)}.{" "}
              {statusLabels[feature.status]}.
            </Dialog.Description>
            <p className="user-content">{feature.description}</p>
            {error && (
              <ErrorNotice
                error={new ApiError(error)}
                title="Не удалось добавить голос"
              />
            )}
            <div className="dialog-actions">
              <StatusBadge status={feature.status} />
              <Button
                onClick={vote}
                disabled={feature.voted || otherVoting}
                loading={voting}
                variant={feature.voted ? "secondary" : "primary"}
              >
                <Icon name={feature.voted ? "check" : "up"} />
                {feature.voted ? "Вы поддержали" : "Поддержать"} ·{" "}
                {feature.votes}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Root>
      </div>
    </Card.Root>
  );
}
