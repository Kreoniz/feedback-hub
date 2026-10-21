import type { Feature, List, Project, Report, ReportPatch } from "./domain";
import type { reportBody } from "./privacy";

export class ApiError extends Error {
  constructor(
    message: string,
    public status = 0,
    public retryAfter: number | null = null,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
export function errorMessage(error: unknown) {
  return error instanceof ApiError
    ? error.message
    : "Не удалось связаться с сервером. Проверьте соединение и попробуйте ещё раз.";
}
export function expiredFormToken(error: unknown) {
  return (
    error instanceof ApiError &&
    [400, 403, 419, 422].includes(error.status) &&
    /(?:token.*expir|expir.*token|токен.*ист[её]к|ист[её]к.*токен|срок.*форм|форм.*ист[её]к|обновите форму)/i.test(
      error.message,
    )
  );
}

export async function request<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const controller = new AbortController();
  const cancel = () => controller.abort(init.signal?.reason);
  if (init.signal?.aborted) cancel();
  init.signal?.addEventListener("abort", cancel, { once: true });
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`/api${path}`, {
      ...init,
      credentials: "same-origin",
      cache: "no-store",
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
    });
    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as {
        error?: unknown;
      } | null;
      const retry = response.headers.get("Retry-After");
      const seconds = retry && /^\d+$/.test(retry) ? Number(retry) : null;
      let message =
        typeof data?.error === "string"
          ? data.error.slice(0, 500)
          : "Сервер не смог выполнить запрос. Попробуйте ещё раз.";
      if (response.status === 429 && seconds)
        message += ` Повторите через ${seconds} с.`;
      if (
        response.status === 401 &&
        path.startsWith("/admin/") &&
        path !== "/admin/login"
      ) {
        window.dispatchEvent(new Event("feedback:session-expired"));
        message = "Сессия завершилась. Войдите снова.";
      }
      throw new ApiError(message, response.status, seconds);
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof ApiError || init.signal?.aborted) throw error;
    throw new ApiError(
      "Не удалось связаться с сервером. Данные сохранены в этой вкладке. Проверьте соединение и повторите действие.",
    );
  } finally {
    clearTimeout(timeout);
    init.signal?.removeEventListener("abort", cancel);
  }
}
const json = (body: unknown) => JSON.stringify(body);
export const api = {
  projects: (signal?: AbortSignal) =>
    request<{ projects: Project[] }>("/projects", { signal }),
  form: (signal?: AbortSignal) =>
    request<{ token: string }>("/form", { signal }),
  features: (query: string, signal?: AbortSignal) =>
    request<List<Feature>>(`/features?${query}`, { signal }),
  report: (body: ReturnType<typeof reportBody>) =>
    request<{ id: string; duplicate: boolean }>("/reports", {
      method: "POST",
      body: json(body),
    }),
  vote: (id: string) =>
    request<{ votes: number; voted: true }>(
      `/features/${encodeURIComponent(id)}/vote`,
      { method: "POST", body: "{}" },
    ),
  session: (signal?: AbortSignal) =>
    request<{ authenticated: boolean; csrf_token?: string }>("/admin/session", {
      signal,
    }),
  login: (password: string) =>
    request<{ authenticated: true; csrf_token: string }>("/admin/login", {
      method: "POST",
      body: json({ password }),
    }),
  logout: (csrf: string) =>
    request<void>("/admin/logout", {
      method: "POST",
      body: "{}",
      headers: { "X-CSRF-Token": csrf },
    }),
  reports: (query: string, signal?: AbortSignal) =>
    request<List<Report>>(`/admin/reports?${query}`, { signal }),
  detail: (id: string, signal?: AbortSignal) =>
    request<Report>(`/admin/reports/${encodeURIComponent(id)}`, { signal }),
  patch: (id: string, body: Partial<ReportPatch>, csrf: string) =>
    request<Report>(`/admin/reports/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: json(body),
      headers: { "X-CSRF-Token": csrf },
    }),
};
