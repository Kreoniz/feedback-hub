import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Alert } from "unlikely-ui/alert";
import { Button } from "unlikely-ui/button";
import { Card } from "unlikely-ui/card";
import { Checkbox } from "unlikely-ui/checkbox";
import { Input } from "unlikely-ui/input";
import { RadioGroup } from "unlikely-ui/radio-group";
import { Textarea } from "unlikely-ui/textarea";
import { api, expiredFormToken } from "./api";
import { validateDraft } from "./domain";
import type { Project, ReportDraft } from "./domain";
import { initialReport, reportBody } from "./privacy";
import { ErrorNotice, FormField, Icon, SelectField } from "./ui";

export function NewReport({ projects }: { projects: Project[] }) {
  const [initial] = useState(() =>
    initialReport(
      new URLSearchParams(window.location.search),
      document.referrer,
      projects,
    ),
  );
  const blankDraft = (): ReportDraft => ({
    project: initial.project,
    type: initial.type,
    title: "",
    description: "",
    details: "",
    website: "",
    includeContext: true,
  });
  const [draft, setDraft] = useState(blankDraft);
  const [errors, setErrors] = useState<ReturnType<typeof validateDraft>>({});
  const [error, setError] = useState<unknown>();
  const [success, setSuccess] = useState(false);
  const [sending, setSending] = useState(false);
  const [token, setToken] = useState("");
  const [tokenLoading, setTokenLoading] = useState(true);
  const [tokenError, setTokenError] = useState<unknown>();
  const [readyAt, setReadyAt] = useState(0);
  const [ready, setReady] = useState(false);
  const [expiredNotice, setExpiredNotice] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const successHeading = useRef<HTMLHeadingElement>(null);
  const tokenRequest = useRef<AbortController | null>(null);
  const refreshToken = useCallback(async () => {
    tokenRequest.current?.abort();
    const controller = new AbortController();
    tokenRequest.current = controller;
    setTokenLoading(true);
    setTokenError(undefined);
    setReady(false);
    setToken("");
    try {
      const result = await api.form(controller.signal);
      if (!controller.signal.aborted) {
        setToken(result.token);
        setReadyAt(Date.now() + 2200);
      }
    } catch (failure) {
      if (!controller.signal.aborted) setTokenError(failure);
    } finally {
      if (!controller.signal.aborted) setTokenLoading(false);
    }
  }, []);
  useEffect(() => {
    void refreshToken();
    return () => tokenRequest.current?.abort();
  }, [refreshToken]);
  useEffect(() => {
    if (!readyAt) return;
    const timer = setTimeout(
      () => setReady(true),
      Math.max(0, readyAt - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [readyAt]);
  useEffect(() => {
    if (success) successHeading.current?.focus();
  }, [success]);
  useEffect(() => {
    const protectDraft = (event: BeforeUnloadEvent) => {
      if (!success && (draft.title || draft.description || draft.details))
        event.preventDefault();
    };
    window.addEventListener("beforeunload", protectDraft);
    return () => window.removeEventListener("beforeunload", protectDraft);
  }, [draft, success]);
  function change<K extends keyof ReportDraft>(key: K, value: ReportDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (sending) return;
    const nextErrors = validateDraft(draft);
    setErrors(nextErrors);
    setError(undefined);
    setExpiredNotice(false);
    if (Object.keys(nextErrors).length) {
      requestAnimationFrame(() =>
        form.current
          ?.querySelector<HTMLElement>(
            '[aria-invalid="true"], [data-invalid] input, [data-invalid] textarea, [data-invalid] button',
          )
          ?.focus(),
      );
      return;
    }
    if (!token || !ready) return;
    setSending(true);
    try {
      await api.report(
        reportBody(
          draft,
          token,
          initial.source,
          navigator.userAgent,
          initial.appVersion,
        ),
      );
      setSuccess(true);
    } catch (failure) {
      if (expiredFormToken(failure)) {
        await refreshToken();
        setExpiredNotice(true);
      } else setError(failure);
    } finally {
      setSending(false);
    }
  }
  if (success)
    return (
      <div className="form-page">
        <Card.Root className="success-card">
          <div className="success-icon">
            <Icon name="check" />
          </div>
          <p className="eyebrow">СООБЩЕНИЕ ПОЛУЧЕНО</p>
          <h1 ref={successHeading} tabIndex={-1}>
            Спасибо за обратную связь.
          </h1>
          <p className="lead">
            {draft.type === "bug"
              ? "Сообщение об ошибке отправлено администратору. Оно останется приватным."
              : "Мы проверим предложение. После одобрения оно появится на доске идей."}
          </p>
          <p className="muted">
            {projects.find((p) => p.slug === draft.project)?.name}
          </p>
          <div className="button-row">
            <Button
              render={
                <a href={`/?project=${encodeURIComponent(draft.project)}`} />
              }
              nativeButton={false}
            >
              К доске идей
              <Icon name="arrow" />
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setDraft(blankDraft());
                setSuccess(false);
                setError(undefined);
                setExpiredNotice(false);
                void refreshToken();
              }}
            >
              Отправить ещё
            </Button>
          </div>
        </Card.Root>
      </div>
    );
  return (
    <div className="form-page">
      <a className="back-link" href="/">
        <Icon name="back" />
        Предложения
      </a>
      <header className="form-heading">
        <h1>Обратная связь</h1>
      </header>
      <Card.Root className="report-card">
        <form onSubmit={submit} noValidate ref={form} className="form-stack">
          <fieldset className="type-fieldset" disabled={sending}>
            <legend>Тип сообщения</legend>
            <RadioGroup.Root
              variant="segmented"
              aria-label="Тип сообщения"
              value={draft.type}
              onValueChange={(value) =>
                change("type", value as ReportDraft["type"])
              }
            >
              <RadioGroup.Item value="feature">Предложение</RadioGroup.Item>
              <RadioGroup.Item value="bug">Ошибка</RadioGroup.Item>
            </RadioGroup.Root>
          </fieldset>
          <SelectField
            label="Проект"
            name="project"
            value={draft.project}
            onChange={(project) => change("project", project)}
            error={errors.project}
            disabled={sending}
            items={[
              { value: "", label: "Выберите проект" },
              ...projects.map((p) => ({ value: p.slug, label: p.name })),
            ]}
          />
          {draft.type === "feature" && (
            <FormField
              label="Название идеи"
              name="title"
              error={errors.title}
              description="Коротко: что вы предлагаете добавить или изменить."
            >
              <Input
                value={draft.title}
                onValueChange={(value) => change("title", value)}
                maxLength={160}
                required
                disabled={sending}
                placeholder="Например, сравнение расписаний на неделю"
                autoComplete="off"
              />
            </FormField>
          )}
          <FormField
            label={draft.type === "bug" ? "Что случилось?" : "Описание идеи"}
            name="description"
            error={errors.description}
            description={
              draft.type === "bug"
                ? "Не указывайте пароли, токены и другие личные данные."
                : "Какую задачу это поможет решить? Не указывайте личные данные."
            }
          >
            <Textarea
              value={draft.description}
              onValueChange={(value) => change("description", value)}
              rows={6}
              maxLength={5000}
              required
              disabled={sending}
              placeholder={
                draft.type === "bug"
                  ? "Открыл расписание, но вместо занятий вижу пустую страницу…"
                  : "Было бы удобно…"
              }
            />
          </FormField>
          <details
            className="optional-details"
            open={errors.details ? true : undefined}
          >
            <summary>
              Добавить подробности<span className="muted">Необязательно</span>
            </summary>
            <div className="form-stack optional-body">
              <FormField
                label="Дополнительные детали"
                name="details"
                error={errors.details}
                description="Для ошибки можно описать шаги, ожидаемый и фактический результат."
              >
                <Textarea
                  value={draft.details}
                  onValueChange={(value) => change("details", value)}
                  rows={4}
                  maxLength={8000}
                  disabled={sending}
                />
              </FormField>
              <label className="checkbox-label">
                <Checkbox
                  checked={draft.includeContext}
                  onCheckedChange={(value) => change("includeContext", value)}
                  disabled={sending}
                />
                <span>
                  Приложить технический контекст
                  <span className="checkbox-description">
                    Семейство браузера
                    {initial.appVersion
                      ? `, версия приложения ${initial.appVersion}`
                      : ""}
                    {initial.source?.project === draft.project
                      ? ", безопасный адрес страницы без параметров"
                      : ""}
                    . Без личных данных.
                  </span>
                </span>
              </label>
              {draft.includeContext &&
                initial.source?.project === draft.project && (
                  <p className="context-preview small">
                    Адрес: {initial.source.url}
                  </p>
                )}
            </div>
          </details>
          <div className="honeypot" aria-hidden="true">
            <label htmlFor="website">Ваш сайт</label>
            <Input
              id="website"
              name="website"
              value={draft.website}
              onValueChange={(value) => change("website", value)}
              tabIndex={-1}
              autoComplete="off"
            />
          </div>
          <div className="privacy-note">
            <Icon name="lock" />
            <div>
              <p>
                {draft.type === "bug"
                  ? "Ошибки и технические детали видит только администратор."
                  : "Идея появится на доске после проверки. Дополнительные детали и технический контекст останутся приватными."}
              </p>
              <p>
                {draft.includeContext
                  ? `Добавим безопасные сведения о браузере${initial.source?.project === draft.project ? ", странице" : ""}${initial.appVersion ? " и версии приложения" : ""}. Можно отключить в подробностях.`
                  : "Технический контекст отключён."}
              </p>
            </div>
          </div>
          {error !== undefined && (
            <ErrorNotice error={error} title="Не удалось отправить сообщение" />
          )}
          {tokenError !== undefined && (
            <ErrorNotice
              error={tokenError}
              title="Не удалось подготовить форму"
              retry={() => void refreshToken()}
            />
          )}
          {expiredNotice && (
            <Alert.Root tone="info">
              <Alert.Description>
                Срок действия формы истёк. Текст сохранён в этой вкладке. После
                подготовки формы нажмите «Отправить сообщение» ещё раз.
              </Alert.Description>
            </Alert.Root>
          )}
          <div className="form-submit">
            <Button
              size="lg"
              type="submit"
              disabled={!token || !ready}
              loading={sending}
            >
              Отправить сообщение
              <Icon name="arrow" />
            </Button>
            <p className="small muted" role="status">
              {tokenLoading
                ? "Подготавливаем форму…"
                : token && !ready
                  ? "Форма будет готова через пару секунд."
                  : "Без регистрации. Спасибо, что помогаете."}
            </p>
          </div>
        </form>
      </Card.Root>
    </div>
  );
}
