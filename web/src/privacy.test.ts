import { describe, expect, it } from "vitest";
import type { Project, ReportDraft } from "./domain";
import {
  browserFamily,
  initialReport,
  reportBody,
  safeContextLink,
  safeSource,
  safeVersion,
} from "./privacy";

const projects: Project[] = [
  {
    slug: "campus",
    name: "Marvin Campus",
    description: "",
    url: "https://campus.kreoniz.ru",
  },
  { slug: "unlikely-ui", name: "Unlikely UI", description: "", url: "" },
  { slug: "other", name: "Другое", description: "", url: "" },
];
const draft: ReportDraft = {
  project: "campus",
  type: "bug",
  title: "Скрытый заголовок идеи",
  description: "  Не работает  ",
  details: "",
  website: "",
  includeContext: true,
};

describe("safe source and context", () => {
  it("infers only an exact canonical origin and drops query, fragment and sensitive paths", () => {
    expect(
      safeSource(
        "https://campus.kreoniz.ru/schedule?token=secret#student",
        projects,
      ),
    ).toEqual({ project: "campus", url: "https://campus.kreoniz.ru/schedule" });
    for (const path of [
      "/students/12345",
      "/reset/secret",
      "/%73chedule",
      "/me@example.com",
    ]) {
      expect(
        safeSource(`https://campus.kreoniz.ru${path}`, projects)?.url,
      ).toBe("https://campus.kreoniz.ru/");
    }
  });
  it.each([
    "https://campus.kreoniz.ru.evil.example/schedule",
    "https://evil.example/campus.kreoniz.ru",
    "https://sub.campus.kreoniz.ru/",
    "https://campus.kreoniz.ru:8443/",
    "http://campus.kreoniz.ru/",
    "https://user:password@campus.kreoniz.ru/",
    "javascript:alert(1)",
    "//campus.kreoniz.ru/",
    "https://unlikely-ui.example/",
    "https://localhost/",
  ])("rejects untrusted source %s", (value) => {
    expect(safeSource(value, projects)).toBeUndefined();
  });
  it("gives explicit project precedence, including an unconfirmed project domain", () => {
    expect(
      initialReport(
        new URLSearchParams("project=unlikely-ui&type=bug"),
        "https://campus.kreoniz.ru/",
        projects,
      ),
    ).toMatchObject({ project: "unlikely-ui", type: "bug" });
    expect(
      initialReport(
        new URLSearchParams("project=unknown"),
        "https://campus.kreoniz.ru/",
        projects,
      ).project,
    ).toBe("");
    expect(
      initialReport(
        new URLSearchParams(),
        "https://campus.kreoniz.ru/compare?secret=x",
        projects,
      ).project,
    ).toBe("campus");
    expect(
      initialReport(
        new URLSearchParams("source=https://evil.example"),
        "",
        projects,
      ).project,
    ).toBe("");
  });
  it("accepts only a bounded release label from explicit version fields", () => {
    expect(safeVersion("v1.2.3-beta.1+build")).toBe("v1.2.3-beta.1+build");
    for (const invalid of [
      "a".repeat(41),
      "https://example.com",
      "user@example.com",
      "token=secret",
      "<script>",
      "release 1",
      "v1\n",
    ])
      expect(safeVersion(invalid)).toBeUndefined();
    expect(
      initialReport(
        new URLSearchParams("version=v2.0&session=secret"),
        "",
        projects,
      ).appVersion,
    ).toBe("v2.0");
  });
  it("omits a stale feature title for bugs and sends only minimized opted-in context", () => {
    const body = reportBody(
      draft,
      "form-token",
      { project: "campus", url: "https://campus.kreoniz.ru/" },
      "Mozilla Firefox/123 private-user-data",
      "1.2.0",
    );
    expect(body).toEqual({
      project: "campus",
      type: "bug",
      description: "Не работает",
      website: "",
      form_token: "form-token",
      context: {
        browser: "Firefox",
        page_url: "https://campus.kreoniz.ru/",
        app_version: "1.2.0",
      },
    });
    expect(
      reportBody(
        { ...draft, includeContext: false },
        "token",
        undefined,
        "UA",
        "1.0",
      ),
    ).not.toHaveProperty("context");
    expect(
      reportBody(
        { ...draft, project: "unlikely-ui" },
        "token",
        { project: "campus", url: "https://campus.kreoniz.ru/" },
        "UA",
      ).context,
    ).not.toHaveProperty("page_url");
  });
  it("recognizes coarse browser families and never returns a full UA", () => {
    expect(browserFamily("Chrome/100 Edg/100")).toBe("Edge");
    expect(browserFamily("Chrome/100 Safari/100")).toBe("Chrome");
    expect(browserFamily("Version/100 Safari/100")).toBe("Safari");
    expect(browserFamily("Some custom user agent")).toBe("Другой браузер");
  });
  it("renders only HTTP links and strips query, credentials and fragments", () => {
    expect(safeContextLink("javascript:alert(1)")).toBeUndefined();
    expect(safeContextLink("https://user:pass@example.com/")).toBeUndefined();
    expect(
      safeContextLink(
        "https://campus.kreoniz.ru/schedule?token=secret#private",
      ),
    ).toBe("https://campus.kreoniz.ru/schedule");
  });
});
