import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Alert } from "unlikely-ui/alert";
import { Badge } from "unlikely-ui/badge";
import { Button } from "unlikely-ui/button";
import { Card } from "unlikely-ui/card";
import { Dialog } from "unlikely-ui/dialog";
import { Input } from "unlikely-ui/input";
import { Textarea } from "unlikely-ui/textarea";
import { api, ApiError } from "./api";
import {
  dateLabel,
  informationLabels,
  listQuery,
  moderationLabels,
  options,
  priorityLabels,
  reportPatch,
  statusLabels,
  typeLabels,
} from "./domain";
import type { Project, Report, ReportPatch } from "./domain";
import { useFilters, usePaginationFocus, useResource, useSearch } from "./hooks";
import { safeContextLink } from "./privacy";
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

const loadSession = (signal: AbortSignal) => api.session(signal);

export function Admin({ projects }: { projects: Project[] }) {
  const session = useResource(loadSession);
  const [csrf, setCsrf] = useState<string | null>();
  const [logoutError, setLogoutError] = useState<unknown>();
  const [loggingOut, setLoggingOut] = useState(false);
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    if (session.data)
      setCsrf(
        session.data.authenticated ? session.data.csrf_token || null : null,
      );
  }, [session.data]);
  useEffect(() => {
    const expire = () => {
      setCsrf(null);
      setExpired(true);
    };
    window.addEventListener("feedback:session-expired", expire);
    return () => window.removeEventListener("feedback:session-expired", expire);
  }, []);
  async function logout() {
    if (!csrf) return;
    setLoggingOut(true);
    setLogoutError(undefined);
    try {
      await api.logout(csrf);
      setCsrf(null);
      setExpired(false);
    } catch (error) {
      setLogoutError(error);
    } finally {
      setLoggingOut(false);
    }
  }
  if (session.loading) return <Loading label="Проверяем сессию" />;
  if (session.error)
    return (
      <div className="form-page">
        <ErrorNotice error={session.error} retry={session.reload} />
      </div>
    );
  if (!csrf)
    return (
      <Login
        expired={expired}
        onLogin={(token) => {
          setCsrf(token);
          setExpired(false);
          setLogoutError(undefined);
        }}
      />
    );
  return (
    <>
      <div className="admin-heading">
        <div>
          <p className="eyebrow">ЛИЧНОЕ ПРОСТРАНСТВО</p>
          <h1>Входящие</h1>
          <p className="lead">
            Идеи и ошибки. Всё, что помогает улучшать проекты.
          </p>
        </div>
        <Button variant="secondary" loading={loggingOut} onClick={logout}>
          Выйти
          <Icon name="arrow" />
        </Button>
      </div>
      {logoutError !== undefined && (
        <ErrorNotice error={logoutError} title="Не удалось выйти" />
      )}
      <Inbox projects={projects} csrf={csrf} />
    </>
  );
}

function Login({
  onLogin,
  expired,
}: {
  onLogin: (csrf: string) => void;
  expired: boolean;
}) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<unknown>();
  const [loading, setLoading] = useState(false);
  const [missing, setMissing] = useState(false);
  async function login(event: FormEvent) {
    event.preventDefault();
    if (loading) return;
    if (!password) {
      setMissing(true);
      return;
    }
    setLoading(true);
    setError(undefined);
    setMissing(false);
    try {
      const result = await api.login(password);
      setPassword("");
      onLogin(result.csrf_token);
    } catch (failure) {
      setError(failure);
    } finally {
      setLoading(false);
    }
  }
  return (
    <div className="login-page">
      <Card.Root className="login-card">
        <div className="empty-icon">
          <Icon name="lock" />
        </div>
        <p className="eyebrow">ДЛЯ АДМИНИСТРАТОРА</p>
        <h1>Вход во входящие</h1>
        <p className="muted">Управление обратной связью и публикацией идей.</p>
        {expired && (
          <Alert.Root tone="info">
            <Alert.Description>
              Сессия завершилась. Войдите снова, чтобы продолжить.
            </Alert.Description>
          </Alert.Root>
        )}
        <form onSubmit={login} className="form-stack" noValidate>
          <FormField
            label="Пароль"
            name="password"
            error={missing ? "Введите пароль." : undefined}
          >
            <Input
              type="password"
              value={password}
              onValueChange={setPassword}
              autoComplete="current-password"
              required
              disabled={loading}
              maxLength={1024}
            />
          </FormField>
          {error !== undefined && (
            <ErrorNotice error={error} title="Не удалось войти" />
          )}
          <Button type="submit" size="lg" loading={loading}>
            Войти
            <Icon name="arrow" />
          </Button>
        </form>
      </Card.Root>
    </div>
  );
}

function Inbox({ projects, csrf }: { projects: Project[]; csrf: string }) {
  const [filters, update] = useFilters(
    [
      "project",
      "type",
      "status",
      "moderation",
      "priority",
      "information",
      "q",
      "sort",
      "offset",
    ],
    "new",
  );
  const query = listQuery(filters, "new");
  const resource = useResource(
    useCallback((signal: AbortSignal) => api.reports(query, signal), [query]),
  );
  const searchChange = useCallback(
    (q: string) => update({ q }, true),
    [update],
  );
  const [search, setSearch] = useSearch(filters.q, searchChange);
  const [selected, setSelected] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [more, setMore] = useState(
    !!(filters.status || filters.priority || filters.information),
  );
  const returnFocus = useRef<HTMLButtonElement | null>(null);
  const dirtyEditor = useRef(false);
  const onDirtyChange = useCallback((dirty: boolean) => { dirtyEditor.current = dirty; }, []);
  const filtered = [
    "project",
    "type",
    "status",
    "moderation",
    "priority",
    "information",
    "q",
  ].some((key) => !!filters[key]);
  const reset = () =>
    update({
      project: "",
      type: "",
      status: "",
      moderation: "",
      priority: "",
      information: "",
      q: "",
      offset: "",
    });
  const offset = Number(new URLSearchParams(query).get("offset"));
  const resultsRegion = usePaginationFocus<HTMLElement>(offset);
  return (
    <section aria-label="Список входящих" ref={resultsRegion} tabIndex={-1}>
      <div className="filter-panel admin-filters">
        <div className="search-field">
          <FormField label="Поиск сообщений" name="q">
            <div className="search-input">
              <Icon name="search" />
              <Input
                type="search"
                value={search}
                onValueChange={setSearch}
                placeholder="Текст сообщения или заметки"
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
          label="Тип"
          name="type"
          value={filters.type}
          onChange={(type) => update({ type })}
          items={[
            { value: "", label: "Все сообщения" },
            ...options(typeLabels),
          ]}
        />
        <SelectField
          label="Модерация"
          name="moderation"
          value={filters.moderation}
          onChange={(moderation) => update({ moderation })}
          items={[
            { value: "", label: "Все сообщения" },
            ...options(moderationLabels),
          ]}
        />
        <SelectField
          label="Порядок"
          name="sort"
          value={filters.sort}
          onChange={(sort) => update({ sort })}
          items={[
            { value: "new", label: "Сначала новые" },
            { value: "old", label: "Сначала старые" },
            { value: "priority", label: "По приоритету" },
          ]}
        />
        <Button
          variant="ghost"
          className="more-filters"
          aria-expanded={more}
          aria-controls="extra-filters"
          onClick={() => setMore((value) => !value)}
        >
          {more ? "Меньше фильтров" : "Все фильтры"}
          <Icon name={more ? "close" : "plus"} />
        </Button>
        {more && (
          <div className="extra-filters" id="extra-filters">
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
              label="Приоритет"
              name="priority"
              value={filters.priority}
              onChange={(priority) => update({ priority })}
              items={[
                { value: "", label: "Любой приоритет" },
                ...options(priorityLabels),
              ]}
            />
            <SelectField
              label="Полнота информации"
              name="information"
              value={filters.information}
              onChange={(information) => update({ information })}
              items={[
                { value: "", label: "Любая полнота" },
                ...options(informationLabels),
              ]}
            />
          </div>
        )}
      </div>
      <div className="list-heading">
        <p className="muted" aria-live="polite">
          {resource.loading
            ? "Обновляем входящие…"
            : resource.data
              ? `Сообщений: ${resource.data.total}`
              : "Список недоступен"}
        </p>
        <div className="button-row">
          {filtered && (
            <Button variant="ghost" size="sm" onClick={reset}>
              Сбросить фильтры
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={resource.reload}
            disabled={resource.loading}
          >
            Обновить
          </Button>
        </div>
      </div>
      <div role="status" className="sr-only">
        {notice}
      </div>
      {resource.loading ? (
        <Loading cards label="Загружаем входящие" />
      ) : resource.error ? (
        <ErrorNotice error={resource.error} retry={resource.reload} />
      ) : (
        resource.data && (
          <>
            {!resource.data.items.length ? (
              <EmptyState filtered={filtered || !!offset} reset={reset} admin />
            ) : (
              <ul className="inbox-list">
                {resource.data.items.map((report) => (
                  <li key={report.id}>
                    <Card.Root className="inbox-card">
                      <Button
                        variant="ghost"
                        className="report-open"
                        onClick={(event) => {
                          returnFocus.current = event.currentTarget;
                          setSelected(report.id);
                        }}
                        aria-label={`Открыть: ${report.title || report.description.slice(0, 80)}`}
                      >
                        <span className={`report-type ${report.type}`}>
                          <Icon
                            name={report.type === "bug" ? "message" : "plus"}
                          />
                        </span>
                        <span className="report-summary">
                          <span className="card-meta">
                            {report.project_name} · {typeLabels[report.type]} ·{" "}
                            {dateLabel(report.created_at)}
                          </span>
                          <span className="report-title">
                            {report.title || report.description.slice(0, 100)}
                          </span>
                          <span className="report-excerpt">
                            {report.description}
                          </span>
                          <span className="badge-row">
                            <Badge
                              tone={
                                report.moderation === "spam" ||
                                report.moderation === "rejected"
                                  ? "danger"
                                  : report.moderation === "approved"
                                    ? "success"
                                    : "warning"
                              }
                            >
                              {moderationLabels[report.moderation]}
                            </Badge>
                            <StatusBadge status={report.status} />
                            <Badge
                              tone={
                                report.priority === "critical" ||
                                report.priority === "high"
                                  ? "danger"
                                  : "neutral"
                              }
                            >
                              {priorityLabels[report.priority]}
                            </Badge>
                            {report.duplicate_of && <Badge>Дубликат</Badge>}
                          </span>
                        </span>
                        <Icon name="arrow" />
                      </Button>
                    </Card.Root>
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
      <Dialog.Root
        open={!!selected}
        onOpenChange={(open) => {
          if (!open && (!dirtyEditor.current || window.confirm("Закрыть сообщение без сохранения изменений?"))) setSelected(null);
        }}
      >
        {selected && (
          <Dialog.Content className="report-dialog" finalFocus={returnFocus}>
            <ReportDetail
              id={selected}
              csrf={csrf}
              onDirtyChange={onDirtyChange}
              onSaved={() => {
                setNotice("Изменения сохранены.");
                resource.reload();
              }}
            />
          </Dialog.Content>
        )}
      </Dialog.Root>
    </section>
  );
}

function ReportDetail({
  id,
  csrf,
  onSaved,
  onDirtyChange,
}: {
  id: string;
  csrf: string;
  onSaved: () => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const resource = useResource(
    useCallback((signal: AbortSignal) => api.detail(id, signal), [id]),
  );
  return (
    <>
      <div className="dialog-heading">
        <p className="eyebrow">СООБЩЕНИЕ</p>
        <Dialog.Close
          render={
            <Button
              variant="ghost"
              size="icon"
              aria-label="Закрыть сообщение"
            />
          }
        >
          <Icon name="close" />
        </Dialog.Close>
      </div>
      {resource.loading ? (
        <>
          <Dialog.Title>Загрузка сообщения</Dialog.Title>
          <Dialog.Description>Получаем полные данные.</Dialog.Description>
          <Loading />
        </>
      ) : resource.error ? (
        <>
          <Dialog.Title>Сообщение недоступно</Dialog.Title>
          <Dialog.Description>
            Попробуйте загрузить его ещё раз.
          </Dialog.Description>
          <ErrorNotice error={resource.error} retry={resource.reload} />
        </>
      ) : (
        resource.data && (
          <ReportEditor
            key={resource.data.id}
            report={resource.data}
            csrf={csrf}
            onDirtyChange={onDirtyChange}
            onSaved={(updated) => {
              resource.setData(updated);
              onSaved();
            }}
          />
        )
      )}
    </>
  );
}

function ReportEditor({
  report,
  csrf,
  onSaved,
  onDirtyChange,
}: {
  report: Report;
  csrf: string;
  onSaved: (report: Report) => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const pick = (value: Report): ReportPatch => ({
    status: value.status,
    priority: value.priority,
    information: value.information,
    moderation: value.moderation,
    duplicate_of: value.duplicate_of,
    admin_note: value.admin_note,
  });
  const [draft, setDraft] = useState(() => pick(report));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>();
  const [saved, setSaved] = useState(false);
  const [duplicateError, setDuplicateError] = useState("");
  const patch = reportPatch(report, draft);
  const dirty = Object.keys(patch).length > 0;
  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);
  const contextLink = safeContextLink(report.context?.page_url);
  const change = <K extends keyof ReportPatch>(
    key: K,
    value: ReportPatch[K],
  ) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setSaved(false);
  };
  async function save(event: FormEvent) {
    event.preventDefault();
    if (saving || !dirty) return;
    setError(undefined);
    setDuplicateError("");
    setSaved(false);
    if (
      draft.duplicate_of &&
      (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        draft.duplicate_of,
      ) ||
        draft.duplicate_of === report.id)
    ) {
      setDuplicateError(
        "Укажите UUID другого сообщения того же проекта и типа.",
      );
      return;
    }
    if (report.type === "bug" && draft.moderation === "approved") {
      setError(new ApiError("Сообщения об ошибках нельзя публиковать."));
      return;
    }
    setSaving(true);
    try {
      const updated = await api.patch(report.id, patch, csrf);
      setDraft(pick(updated));
      onSaved(updated);
      setSaved(true);
    } catch (failure) {
      setError(failure);
    } finally {
      setSaving(false);
    }
  }
  return (
    <>
      <Dialog.Title>{report.title || "Сообщение об ошибке"}</Dialog.Title>
      <Dialog.Description>
        {report.project_name} · {typeLabels[report.type]} ·{" "}
        {dateLabel(report.created_at)}
      </Dialog.Description>
      <div className="report-content">
        <h3>Описание</h3>
        <p className="user-content">{report.description}</p>
        {report.details && (
          <>
            <h3>Дополнительные детали · приватно</h3>
            <p className="user-content">{report.details}</p>
          </>
        )}
        <dl className="context-list">
          <div>
            <dt>ID сообщения</dt>
            <dd className="mono">{report.id}</dd>
          </div>
          <div>
            <dt>Обновлено</dt>
            <dd>{dateLabel(report.updated_at)}</dd>
          </div>
          <div>
            <dt>Голоса</dt>
            <dd>{report.votes}</dd>
          </div>
          {report.context?.browser && (
            <div>
              <dt>Браузер</dt>
              <dd>{report.context.browser}</dd>
            </div>
          )}
          {report.context?.app_version && (
            <div>
              <dt>Версия приложения</dt>
              <dd>{report.context.app_version}</dd>
            </div>
          )}
          {contextLink && (
            <div>
              <dt>Страница</dt>
              <dd>
                <a href={contextLink} target="_blank" rel="noreferrer noopener">
                  {contextLink}
                </a>
              </dd>
            </div>
          )}
        </dl>
      </div>
      <form onSubmit={save} className="form-stack admin-editor" noValidate>
        <div className="editor-grid">
          <SelectField
            label="Статус"
            name="status"
            value={draft.status}
            onChange={(value) =>
              change("status", value as ReportPatch["status"])
            }
            items={options(statusLabels)}
            disabled={saving}
          />
          <SelectField
            label="Приоритет"
            name="priority"
            value={draft.priority}
            onChange={(value) =>
              change("priority", value as ReportPatch["priority"])
            }
            items={options(priorityLabels)}
            disabled={saving}
          />
          <SelectField
            label="Модерация"
            name="moderation"
            value={draft.moderation}
            onChange={(value) =>
              change("moderation", value as ReportPatch["moderation"])
            }
            items={options(
              report.type === "bug"
                ? {
                    pending: moderationLabels.pending,
                    rejected: moderationLabels.rejected,
                    spam: moderationLabels.spam,
                  }
                : moderationLabels,
            )}
            disabled={saving}
          />
          <SelectField
            label="Полнота информации"
            name="information"
            value={draft.information}
            onChange={(value) =>
              change("information", value as ReportPatch["information"])
            }
            items={options(informationLabels)}
            disabled={saving}
          />
        </div>
        <p className="small muted">
          Приоритет и полнота информации независимы. Даже короткое сообщение
          может быть критическим.
        </p>
        {report.type === "feature" &&
          draft.moderation === "approved" &&
          !draft.duplicate_of && (
            <div className="publication-preview">
              <Alert.Root tone="warning">
                <Alert.Title>Проверьте перед публикацией</Alert.Title>
                <Alert.Description>
                  На доске появятся точные название и описание ниже. Проверьте,
                  что в них нет личных данных. Если они есть, оставьте идею на
                  проверке или отклоните её. Детали, контекст и заметки
                  останутся приватными.
                </Alert.Description>
              </Alert.Root>
              <Card.Root>
                <p className="eyebrow">ПУБЛИЧНОЕ НАЗВАНИЕ</p>
                <h3>{report.title}</h3>
                <p className="eyebrow">ПУБЛИЧНОЕ ОПИСАНИЕ</p>
                <p className="user-content">{report.description}</p>
              </Card.Root>
            </div>
          )}
        {draft.moderation === "spam" && (
          <Alert.Root tone="warning">
            <Alert.Description>
              Сообщение будет помечено как спам и скрыто с доски. Оно останется
              во входящих с фильтром «Спам».
            </Alert.Description>
          </Alert.Root>
        )}
        <details
          className="optional-details"
          open={draft.duplicate_of ? true : undefined}
        >
          <summary>
            Связь с оригиналом<span className="muted">Дубликаты</span>
          </summary>
          <div className="optional-body form-stack">
            <FormField
              label="ID оригинального сообщения"
              name="duplicate_of"
              error={duplicateError}
              description="UUID сообщения того же проекта и типа. Оставьте пустым, чтобы снять связь."
            >
              <Input
                value={draft.duplicate_of || ""}
                onValueChange={(value) => {
                  change("duplicate_of", value.trim() || null);
                  setDuplicateError("");
                }}
                autoComplete="off"
                spellCheck={false}
                disabled={saving}
                maxLength={36}
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              />
            </FormField>
            <p className="small muted">
              Связанный дубликат скроется с публичной доски. Сообщение и его
              голоса сохранятся; голоса не переносятся.
            </p>
          </div>
        </details>
        <FormField
          label="Заметка администратора"
          name="admin_note"
          description="Приватно. Можно записать решение или причину отклонения."
        >
          <Textarea
            value={draft.admin_note}
            onValueChange={(value) => change("admin_note", value)}
            rows={3}
            maxLength={8000}
            disabled={saving}
          />
        </FormField>
        {error !== undefined && (
          <ErrorNotice error={error} title="Изменения не сохранены" />
        )}
        <div className="editor-actions">
          <p className="small muted" role="status">
            {saved
              ? "Изменения сохранены."
              : dirty
                ? "Есть несохранённые изменения."
                : "Все изменения сохранены."}
          </p>
          <div className="button-row">
            <Button
              variant="secondary"
              type="button"
              disabled={!dirty || saving}
              onClick={() => {
                setDraft(pick(report));
                setError(undefined);
                setSaved(false);
                setDuplicateError("");
              }}
            >
              Отменить правки
            </Button>
            <Button type="submit" disabled={!dirty} loading={saving}>
              Сохранить
              <Icon name="check" />
            </Button>
          </div>
        </div>
      </form>
    </>
  );
}
