import { projectChoices } from "./projects";
import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Alert } from "unlikely-ui/alert";
import { Badge } from "unlikely-ui/badge";
import { Button } from "unlikely-ui/button";
import { Card } from "unlikely-ui/card";
import { Dialog } from "unlikely-ui/dialog";
import { Input } from "unlikely-ui/input";
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
import {
  useFilters,
  usePaginationFocus,
  useResource,
  useSearch,
} from "./hooks";
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
        <h1>Входящие</h1>
        <Button
          variant="secondary"
          size="sm"
          loading={loggingOut}
          onClick={logout}
        >
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
  const [detailOpen, setDetailOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [more, setMore] = useState(
    !!(
      filters.status ||
      filters.priority ||
      filters.information ||
      filters.moderation ||
      (filters.sort && filters.sort !== "new")
    ),
  );
  const dirtyEditor = useRef(false);
  const onDirtyChange = useCallback((dirty: boolean) => {
    dirtyEditor.current = dirty;
  }, []);
  const extraFilterCount =
    ["status", "moderation", "priority", "information"].filter(
      (key) => !!filters[key],
    ).length + (filters.sort && filters.sort !== "new" ? 1 : 0);
  const filtered =
    extraFilterCount > 0 ||
    ["project", "type", "q"].some((key) => !!filters[key]);
  const reset = () => {
    setSearch("");
    update({
      project: "",
      type: "",
      status: "",
      moderation: "",
      priority: "",
      information: "",
      q: "",
      offset: "",
      sort: "new",
    });
  };
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
                placeholder="Текст сообщения"
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
          label="Тип"
          name="type"
          value={filters.type}
          onChange={(type) => update({ type })}
          items={[{ value: "", label: "Все" }, ...options(typeLabels)]}
        />
        {more && (
          <div className="extra-filters" id="extra-filters">
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
              label="Информативность"
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
          <Button
            variant="ghost"
            size="sm"
            className="more-filters"
            aria-expanded={more}
            aria-controls="extra-filters"
            onClick={() => setMore((value) => !value)}
          >
            {more ? "Скрыть фильтры" : "Фильтры"}
            {extraFilterCount > 0 && ` · ${extraFilterCount}`}
            <Icon name={more ? "close" : "plus"} />
          </Button>
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
                        id={`report-${report.id}`}
                        variant="ghost"
                        className="report-open"
                        onClick={() => {
                          setSelected(report.id);
                          setDetailOpen(true);
                        }}
                        aria-label={`Открыть: ${report.title || report.description.slice(0, 80)}`}
                      >
                        <span className="report-row">
                          <span className={`report-type ${report.type}`}>
                            <Icon
                              name={report.type === "bug" ? "message" : "plus"}
                            />
                          </span>
                          <span className="report-summary">
                            <span className="card-meta">
                              {report.project_name} · {typeLabels[report.type]}{" "}
                              · {dateLabel(report.created_at)}
                            </span>
                            <span className="report-title">
                              {report.title || report.description.slice(0, 100)}
                            </span>
                            {report.title &&
                              report.description !== report.title && (
                                <span className="report-excerpt">
                                  {report.description}
                                </span>
                              )}
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
                              {report.priority !== "untriaged" && (
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
                              )}
                              {report.duplicate_of && <Badge>Дубликат</Badge>}
                            </span>
                          </span>
                          <Icon name="arrow" />
                        </span>
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
        open={detailOpen}
        onOpenChange={(open) => {
          if (
            !open &&
            (!dirtyEditor.current ||
              window.confirm("Закрыть сообщение без сохранения изменений?"))
          )
            setDetailOpen(false);
        }}
        onOpenChangeComplete={(open) => {
          if (!open) setSelected(null);
        }}
      >
        {selected && (
          <Dialog.Content
            className="report-dialog"
            finalFocus={() =>
              document.getElementById(`report-${selected}`) ||
              resultsRegion.current
            }
          >
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
        <p className="user-content">{report.description}</p>
        {report.details && (
          <>
            <h3>Дополнительные детали · приватно</h3>
            <p className="user-content">{report.details}</p>
          </>
        )}
        <details className="technical-details">
          <summary>Технические сведения</summary>
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
                  <a
                    href={contextLink}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    {contextLink}
                  </a>
                </dd>
              </div>
            )}
          </dl>
        </details>
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
            label="Информативность"
            name="information"
            value={draft.information}
            onChange={(value) =>
              change("information", value as ReportPatch["information"])
            }
            items={options(informationLabels)}
            disabled={saving}
          />
        </div>
        <p className="small muted">Приоритет задаётся отдельно.</p>
        {report.type === "feature" &&
          draft.moderation === "approved" &&
          !draft.duplicate_of && (
            <div className="publication-preview">
              <Alert.Root tone="warning">
                <Alert.Title>Проверьте перед публикацией</Alert.Title>
                <Alert.Description>
                  На доске появятся название и описание сообщения выше.
                  Проверьте, что в них нет личных данных. Дополнительные детали
                  и технические сведения останутся приватными.
                </Alert.Description>
              </Alert.Root>
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
        {error !== undefined && (
          <ErrorNotice error={error} title="Изменения не сохранены" />
        )}
        <div className="editor-actions">
          <p className="small muted" role="status">
            {saved
              ? "Изменения сохранены."
              : dirty
                ? "Есть несохранённые изменения."
                : ""}
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
              Отменить
            </Button>
            <Button type="submit" disabled={!dirty} loading={saving}>
              Сохранить
            </Button>
          </div>
        </div>
      </form>
    </>
  );
}
