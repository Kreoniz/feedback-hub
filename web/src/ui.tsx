import type { ReactNode } from "react";
import { Alert } from "unlikely-ui/alert";
import { Badge } from "unlikely-ui/badge";
import type { StatusTone } from "unlikely-ui/badge";
import { Button } from "unlikely-ui/button";
import { Card } from "unlikely-ui/card";
import { Field } from "unlikely-ui/field";
import { Select } from "unlikely-ui/select";
import { Skeleton } from "unlikely-ui/skeleton";
import { Spinner } from "unlikely-ui/spinner";
import { errorMessage } from "./api";
import { MAX_OFFSET, PAGE_SIZE, statusLabels } from "./domain";
import type { Status } from "./domain";

export function Icon({
  name,
  className = "",
}: {
  name:
    | "arrow"
    | "up"
    | "plus"
    | "search"
    | "close"
    | "check"
    | "moon"
    | "sun"
    | "back"
    | "lock"
    | "message";
  className?: string;
}) {
  const paths: Record<typeof name, ReactNode> = {
    arrow: <path d="m5 12 14 0m-5-5 5 5-5 5" />,
    up: <path d="m6 14 6-6 6 6" />,
    plus: <path d="M12 5v14M5 12h14" />,
    search: (
      <>
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="m16 16 4 4" />
      </>
    ),
    close: <path d="m6 6 12 12M6 18 18 6" />,
    check: <path d="m5 12 4 4L19 6" />,
    moon: <path d="M20 14A8 8 0 0 1 10 4a8 8 0 1 0 10 10Z" />,
    sun: (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1" />
      </>
    ),
    back: <path d="M19 12H5m5-5-5 5 5 5" />,
    lock: (
      <>
        <rect x="5" y="10" width="14" height="11" rx="2" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3m-4 4v3" />
      </>
    ),
    message: (
      <path d="M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-6 4V6a2 2 0 0 1 2-2Z" />
    ),
  };
  return (
    <svg
      className={`icon ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}

export function FormField({
  label,
  name,
  description,
  error,
  children,
  className = "",
}: {
  label: string;
  name: string;
  description?: ReactNode;
  error?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Field.Root name={name} invalid={!!error} className={className}>
      <Field.Label>{label}</Field.Label>
      {children}
      {description && <Field.Description>{description}</Field.Description>}
      {error && <Field.Error match={true}>{error}</Field.Error>}
    </Field.Root>
  );
}

export type Choice = { value: string; label: string };
export function SelectField({
  label,
  value,
  onChange,
  items,
  name,
  error,
  description,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  items: Choice[];
  name: string;
  error?: string;
  description?: string;
  disabled?: boolean;
}) {
  return (
    <FormField
      label={label}
      name={name}
      error={error}
      description={description}
    >
      <Select.Root
        items={items}
        value={value}
        onValueChange={(next) => {
          if (next !== null) onChange(next);
        }}
        disabled={disabled}
      >
        <Select.Trigger>
          <Select.Value />
        </Select.Trigger>
        <Select.Content>
          {items.map((item) => (
            <Select.Item key={item.value || "all"} value={item.value}>
              {item.label}
            </Select.Item>
          ))}
        </Select.Content>
      </Select.Root>
    </FormField>
  );
}

export function ErrorNotice({
  error,
  retry,
  title = "Не получилось загрузить данные",
}: {
  error: unknown;
  retry?: () => void;
  title?: string;
}) {
  return (
    <Alert.Root tone="danger" role="alert">
      <Alert.Title>{title}</Alert.Title>
      <Alert.Description>{errorMessage(error)}</Alert.Description>
      {retry && (
        <Alert.Actions>
          <Button variant="secondary" onClick={retry}>
            Попробовать ещё раз
          </Button>
        </Alert.Actions>
      )}
    </Alert.Root>
  );
}

export function Loading({
  label = "Загружаем…",
  cards = false,
}: {
  label?: string;
  cards?: boolean;
}) {
  return (
    <div className="loading-state" aria-busy="true">
      <Spinner label={label} />
      {cards && (
        <div className="skeleton-list" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <Card.Root key={i} className="skeleton-card">
              <Skeleton style={{ width: "45%", height: "1.2rem" }} />
              <Skeleton style={{ width: "90%", height: "1rem" }} />
              <Skeleton style={{ width: "65%", height: "1rem" }} />
            </Card.Root>
          ))}
        </div>
      )}
    </div>
  );
}

export function EmptyState({
  filtered,
  reset,
  admin = false,
}: {
  filtered: boolean;
  reset: () => void;
  admin?: boolean;
}) {
  return (
    <Card.Root className="empty-state">
      <div className="empty-icon">
        <Icon name={filtered ? "search" : "message"} />
      </div>
      <Card.Title>
        {filtered
          ? "Ничего не нашлось"
          : admin
            ? "Пока всё спокойно"
            : "Здесь начинается следующая идея"}
      </Card.Title>
      <Card.Description>
        {filtered
          ? "Попробуйте другой запрос или уберите часть фильтров."
          : admin
            ? "Новые сообщения появятся здесь."
            : "Пока нет опубликованных предложений. Расскажите, чего вам не хватает."}
      </Card.Description>
      {filtered ? (
        <Button variant="secondary" onClick={reset}>
          Сбросить фильтры
        </Button>
      ) : (
        !admin && (
          <Button render={<a href="/new" />} nativeButton={false}>
            <Icon name="plus" />
            Предложить идею
          </Button>
        )
      )}
    </Card.Root>
  );
}

export function StatusBadge({ status }: { status: Status }) {
  const tones: Record<Status, StatusTone> = {
    new: "neutral",
    planned: "info",
    in_progress: "warning",
    done: "success",
    closed: "neutral",
  };
  return (
    <Badge tone={tones[status] || "neutral"}>
      <span className="status-dot" />
      {statusLabels[status] || status}
    </Badge>
  );
}

export function Pagination({
  offset,
  total,
  onChange,
}: {
  offset: number;
  total: number;
  onChange: (offset: string) => void;
}) {
  if (total <= PAGE_SIZE && !offset) return null;
  return (
    <nav className="pagination" aria-label="Страницы списка">
      <span className="muted">
        {total
          ? `${Math.min(offset + 1, total)}–${Math.min(offset + PAGE_SIZE, total)} из ${total}`
          : "Нет записей"}
      </span>
      <div className="button-row">
        <Button
          variant="secondary"
          disabled={offset === 0}
          onClick={() => onChange(String(Math.max(0, offset - PAGE_SIZE)))}
        >
          <Icon name="back" />
          Назад
        </Button>
        <Button
          variant="secondary"
          disabled={
            offset + PAGE_SIZE >= total || offset + PAGE_SIZE > MAX_OFFSET
          }
          onClick={() => onChange(String(offset + PAGE_SIZE))}
        >
          Дальше
          <Icon name="arrow" />
        </Button>
      </div>
      {offset + PAGE_SIZE > MAX_OFFSET && total > offset + PAGE_SIZE && (
        <p className="muted">Для более ранних записей уточните фильтры.</p>
      )}
    </nav>
  );
}
