export type Project = {
  slug: string;
  name: string;
  description: string;
  url: string;
};
export type ReportType = "feature" | "bug";
export type Status = "new" | "planned" | "in_progress" | "done" | "closed";
export type Priority = "untriaged" | "low" | "normal" | "high" | "critical";
export type Information = "sparse" | "useful" | "detailed";
export type Moderation = "pending" | "approved" | "rejected" | "spam";
export type Feature = {
  id: string;
  project: string;
  project_name: string;
  title: string;
  description: string;
  status: Status;
  votes: number;
  voted: boolean;
  created_at: string;
};
export type ReportContext = {
  page_url?: string;
  browser?: string;
  app_version?: string;
};
export type Report = Feature & {
  type: ReportType;
  details: string;
  context: ReportContext | null;
  moderation: Moderation;
  priority: Priority;
  information: Information;
  duplicate_of: string | null;
  admin_note: string;
  updated_at: string;
};
export type ReportPatch = Pick<
  Report,
  | "status"
  | "priority"
  | "information"
  | "moderation"
  | "duplicate_of"
  | "admin_note"
>;
export type List<T> = { items: T[]; total: number };
export type ReportDraft = {
  project: string;
  type: ReportType;
  title: string;
  description: string;
  details: string;
  website: string;
  includeContext: boolean;
};
export const statusLabels: Record<Status, string> = {
  new: "Новая",
  planned: "В планах",
  in_progress: "В работе",
  done: "Готово",
  closed: "Закрыта",
};
export const priorityLabels: Record<Priority, string> = {
  untriaged: "Не назначен",
  low: "Низкий",
  normal: "Обычный",
  high: "Высокий",
  critical: "Критический",
};
export const informationLabels: Record<Information, string> = {
  sparse: "Мало деталей",
  useful: "Достаточно",
  detailed: "Подробно",
};
export const moderationLabels: Record<Moderation, string> = {
  pending: "На проверке",
  approved: "Одобрено",
  rejected: "Отклонено",
  spam: "Спам",
};
export const typeLabels: Record<ReportType, string> = {
  feature: "Идея",
  bug: "Ошибка",
};
export const PAGE_SIZE = 30;
export const MAX_OFFSET = 9990;
export function filterValue(key: string, value: string, defaultSort: string) {
  const allowed: Record<string, string[]> = {
    project: ["campus", "unlikely-ui", "other"],
    type: Object.keys(typeLabels),
    status: Object.keys(statusLabels),
    priority: Object.keys(priorityLabels),
    information: Object.keys(informationLabels),
    moderation: Object.keys(moderationLabels),
    sort:
      defaultSort === "votes" ? ["votes", "new"] : ["new", "old", "priority"],
  };
  if (key === "q") return value.trim().slice(0, 200);
  return allowed[key]
    ? allowed[key].includes(value)
      ? value
      : key === "sort"
        ? defaultSort
        : ""
    : value;
}
export const options = (labels: Record<string, string>) =>
  Object.entries(labels).map(([value, label]) => ({ value, label }));
export const dateLabel = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Дата неизвестна"
    : new Intl.DateTimeFormat("ru", {
        day: "numeric",
        month: "short",
        year: "numeric",
      }).format(date);
};
export function listQuery(values: Record<string, string>, defaultSort: string) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values))
    if (value && key !== "offset") params.set(key, value);
  const offset = Number(values.offset || 0);
  params.set(
    "offset",
    String(
      Number.isFinite(offset)
        ? Math.max(
            0,
            Math.min(MAX_OFFSET, Math.floor(offset / PAGE_SIZE) * PAGE_SIZE),
          )
        : 0,
    ),
  );
  params.set("limit", String(PAGE_SIZE));
  if (!params.has("sort")) params.set("sort", defaultSort);
  return params.toString();
}
export function validateDraft(draft: ReportDraft) {
  const errors: Partial<
    Record<"project" | "title" | "description" | "details", string>
  > = {};
  if (!draft.project) errors.project = "Выберите проект.";
  if (draft.type === "feature" && !draft.title.trim())
    errors.title = "Коротко назовите идею.";
  if (draft.title.trim().length > 160)
    errors.title = "В заголовке должно быть не больше 160 символов.";
  if (!draft.description.trim()) errors.description = "Добавьте описание.";
  if (draft.description.trim().length > 5000)
    errors.description = "В описании должно быть не больше 5000 символов.";
  if (draft.details.trim().length > 8000)
    errors.details = "В деталях должно быть не больше 8000 символов.";
  return errors;
}
export function reportPatch(
  report: Report,
  next: ReportPatch,
): Partial<ReportPatch> {
  const patch: Partial<ReportPatch> = {};
  for (const key of [
    "status",
    "priority",
    "information",
    "moderation",
    "duplicate_of",
    "admin_note",
  ] as const) {
    if (report[key] !== next[key]) Object.assign(patch, { [key]: next[key] });
  }
  return patch;
}
