import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Button } from "unlikely-ui/button";
import { Card } from "unlikely-ui/card";
import { Dialog } from "unlikely-ui/dialog";
import { Input } from "unlikely-ui/input";
import { PhysicalButton } from "unlikely-ui/physical-button";
import { ProjectLink } from "./ProjectLink";
import { projectChoices } from "./projects";
import { api, ApiError, errorMessage } from "./api";
import { dateLabel, listQuery, options, statusLabels } from "./domain";
import type { Feature, Project } from "./domain";
import {
  useFilters,
  usePaginationFocus,
  useResource,
  useSearch,
} from "./hooks";
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
  function reset() {
    // Clear pending input too: its debounce may not have reached the URL yet.
    setSearch("");
    update({ project: "", q: "", status: "", offset: "" });
  }
  const visitorProof = useRef<Promise<unknown> | null>(null);
  const [announcement, setAnnouncement] = useState("");
  // Share the initial proof even when separate cards are clicked concurrently.
  const ensureVisitor = useCallback(() => {
    if (!visitorProof.current) {
      visitorProof.current = api.form().catch((error) => {
        visitorProof.current = null;
        throw error;
      });
    }
    return visitorProof.current;
  }, []);
  useEffect(() => {
    void ensureVisitor().catch(() => {});
  }, [ensureVisitor]);
  const { updateData } = resource;
  const voteChanged = useCallback(
    (feature: Feature, result: Pick<Feature, "votes" | "voted">) => {
      updateData((data) =>
        data
          ? {
              ...data,
              items: data.items.map((item) =>
                item.id === feature.id ? { ...item, ...result } : item,
              ),
            }
          : data,
      );
      setAnnouncement(
        result.voted
          ? `Вы поддержали предложение «${feature.title}».`
          : `Голос за предложение «${feature.title}» отменён.`,
      );
    },
    [updateData],
  );
  const filtered = !!(filters.project || filters.q || filters.status);
  const offset = Number(new URLSearchParams(query).get("offset"));
  const resultsHeading = usePaginationFocus<HTMLHeadingElement>(offset);
  return (
    <>
      <section className="board-main" aria-label="Предложения">
        <div className="board-heading">
          <h1 ref={resultsHeading} tabIndex={-1}>
            Предложения
          </h1>
          <Button
            render={
              <a
                href={`/new${filters.project ? `?project=${encodeURIComponent(filters.project)}` : ""}`}
              />
            }
            nativeButton={false}
          >
            <Icon name="plus" />
            Написать
          </Button>
        </div>
        <div className="filter-panel board-filters">
          <div className="search-field">
            <FormField label="Поиск предложений" name="q">
              <div className="search-input">
                <Icon name="search" />
                <Input
                  type="search"
                  value={search}
                  onValueChange={setSearch}
                  placeholder="Поиск"
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
            items={projectChoices(projects)}
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
              ? "Загружаем…"
              : resource.data
                ? `Найдено: ${resource.data.total}`
                : "Не удалось обновить список"}
          </p>
          {filtered && (
            <Button
              variant="ghost"
              size="sm"
              onClick={reset}
            >
              Сбросить
              <Icon name="close" />
            </Button>
          )}
        </div>
        <div className="sr-only" role="status">
          {announcement}
        </div>
        {resource.loading ? (
          <Loading cards label="Загружаем предложения" />
        ) : resource.error ? (
          <ErrorNotice error={resource.error} retry={resource.reload} />
        ) : (
          resource.data && (
            <>
              {!resource.data.items.length ? (
                <EmptyState
                  filtered={filtered || !!offset}
                  reset={reset}
                />
              ) : (
                <ul className="feature-list">
                  {resource.data.items.map((feature) => (
                    <li key={feature.id}>
                      <FeatureCard
                        feature={feature}
                        project={projects.find(
                          (p) => p.slug === feature.project,
                        )}
                        ensureVisitor={ensureVisitor}
                        onVoteChange={voteChanged}
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
    </>
  );
}

const FeatureCard = memo(function FeatureCard({
  feature,
  project,
  ensureVisitor,
  onVoteChange,
}: {
  feature: Feature;
  project?: Project;
  ensureVisitor: () => Promise<unknown>;
  onVoteChange: (
    feature: Feature,
    result: Pick<Feature, "votes" | "voted">,
  ) => void;
}) {
  const [voting, setVoting] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const inFlight = useRef(false);
  async function vote() {
    if (inFlight.current) return;
    inFlight.current = true;
    setVoting(true);
    setError("");
    try {
      await ensureVisitor();
      const result = await (feature.voted
        ? api.unvote(feature.id)
        : api.vote(feature.id));
      onVoteChange(feature, result);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      inFlight.current = false;
      setVoting(false);
    }
  }
  return (
    <Card.Root className="feature-card">
      <PhysicalButton
        className="vote-button"
        size="sm"
        pattern="plain"
        depth="low"
        colors={{
          cap: feature.voted ? "var(--u-accent)" : "var(--u-surface-raised)",
          capText: feature.voted ? "var(--u-accent-ink)" : "var(--u-ink)",
          casing: "var(--u-line)",
          plate: "var(--u-well)",
        }}
        aria-label={`${feature.voted ? "Отменить голос" : "Поддержать"}: ${feature.title}. Голосов: ${feature.votes}`}
        aria-pressed={feature.voted}
        aria-busy={voting}
        disabled={voting}
        focusableWhenDisabled
        onClick={vote}
      >
        <span className="vote-cap">
          <Icon name={feature.voted ? "check" : "up"} />
          <span>{feature.votes}</span>
        </span>
      </PhysicalButton>
      <div className="feature-body">
        <div className="card-meta">
          <ProjectLink
            project={project}
            slug={feature.project}
            name={feature.project_name}
          />
          <span aria-hidden="true">·</span>
          <time dateTime={feature.created_at}>
            {dateLabel(feature.created_at)}
          </time>
        </div>
        <Dialog.Root open={open} onOpenChange={setOpen}>
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
          {error && !open && (
            <ErrorNotice
              error={new ApiError(error)}
              title="Не удалось изменить голос"
            />
          )}
          <Dialog.Content className="idea-dialog">
            <div className="dialog-heading">
              <ProjectLink
                project={project}
                slug={feature.project}
                name={feature.project_name}
              />
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
            {error && open && (
              <ErrorNotice
                error={new ApiError(error)}
                title="Не удалось изменить голос"
              />
            )}
            <div className="dialog-actions">
              <StatusBadge status={feature.status} />
              <Button
                onClick={vote}
                disabled={voting}
                loading={voting}
                variant={feature.voted ? "secondary" : "primary"}
              >
                <Icon name={feature.voted ? "check" : "up"} />
                {feature.voted ? "Отменить голос" : "Поддержать"} ·{" "}
                {feature.votes}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Root>
      </div>
    </Card.Root>
  );
});
