import type { Project, ReportContext, ReportDraft } from "./domain";

const knownProjects = new Set(["campus", "unlikely-ui", "other"]);

/** Canonical project origins supplied by the server are the source allowlist.
 * No suffix matching, arbitrary query origin, or external redirect is trusted. */
export function sourceAllowlist(projects: Project[]) {
  const origins = new Map<string, string>();
  for (const project of projects) {
    if (!knownProjects.has(project.slug) || project.slug === "other") continue;
    try {
      const url = new URL(project.url);
      if (
        url.protocol === "https:" &&
        !url.username &&
        !url.password &&
        url.port === ""
      )
        origins.set(url.origin, project.slug);
    } catch {
      /* A missing canonical URL does not authorize any source. */
    }
  }
  return origins;
}

export function safeSource(
  raw: string | null | undefined,
  projects: Project[],
): { project: string; url: string } | undefined {
  if (!raw || raw.length > 2048) return;
  try {
    const url = new URL(raw);
    if (url.username || url.password || url.protocol !== "https:") return;
    const project = sourceAllowlist(projects).get(url.origin);
    if (!project) return;
    // Retain only predictable application routes. IDs, email-like segments,
    // encoded segments and arbitrary paths can contain personal information.
    const safePaths = new Set([
      "/",
      "/schedule",
      "/compare",
      "/settings",
      "/components",
      "/docs",
    ]);
    return {
      project,
      url: url.origin + (safePaths.has(url.pathname) ? url.pathname : "/"),
    };
  } catch {
    return;
  }
}

export function initialReport(
  params: URLSearchParams,
  referrer: string,
  projects: Project[],
) {
  const explicit = params.get("project");
  const source =
    safeSource(params.get("source"), projects) ||
    safeSource(referrer, projects);
  const project =
    explicit !== null
      ? projects.some((p) => p.slug === explicit)
        ? explicit
        : ""
      : source?.project || "";
  return {
    project,
    type:
      params.get("type") === "bug" ? ("bug" as const) : ("feature" as const),
    source,
    appVersion: safeVersion(params.get("app_version") || params.get("version")),
  };
}

export function safeVersion(raw: string | null | undefined) {
  return raw && /^[a-zA-Z0-9][a-zA-Z0-9._+\-]{0,39}$/.test(raw)
    ? raw
    : undefined;
}

/** Coarse browser family only; never send a full UA, location, or URL parameters. */
export function browserFamily(ua: string) {
  if (/Edg\//.test(ua)) return "Edge";
  if (/Firefox\//.test(ua)) return "Firefox";
  if (/Chrome\//.test(ua)) return "Chrome";
  if (/Safari\//.test(ua)) return "Safari";
  return "Другой браузер";
}
export function reportBody(
  draft: ReportDraft,
  token: string,
  source: ReturnType<typeof safeSource>,
  ua: string,
  version?: string,
) {
  const context: ReportContext | undefined = draft.includeContext
    ? {
        ...(source?.project === draft.project ? { page_url: source.url } : {}),
        browser: browserFamily(ua),
        ...(safeVersion(version) ? { app_version: safeVersion(version) } : {}),
      }
    : undefined;
  return {
    project: draft.project,
    type: draft.type,
    ...(draft.type === "feature" ? { title: draft.title.trim() } : {}),
    description: draft.description.trim(),
    ...(draft.details.trim() ? { details: draft.details.trim() } : {}),
    ...(context ? { context } : {}),
    website: draft.website,
    form_token: token,
  };
}
export function safeContextLink(raw: string | undefined) {
  if (!raw) return;
  try {
    const url = new URL(raw);
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      return;
    return url.origin + url.pathname;
  } catch {
    return;
  }
}
