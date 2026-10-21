import { describe, expect, it } from "vitest";
import { filterValue, listQuery, reportPatch, validateDraft } from "./domain";
import type { Report, ReportDraft, ReportPatch } from "./domain";

const bug: ReportDraft = {
  project: "campus",
  type: "bug",
  title: "",
  description: "Сломалось",
  details: "",
  website: "",
  includeContext: true,
};
describe("report validation and independent metadata", () => {
  it("requires only description content for a bug and a title for a feature", () => {
    expect(validateDraft(bug)).toEqual({});
    expect(validateDraft({ ...bug, type: "feature" })).toEqual({
      title: "Коротко назовите идею.",
    });
    expect(validateDraft({ ...bug, description: "  " })).toHaveProperty(
      "description",
    );
  });
  it("enforces the real server bounds before sending", () => {
    expect(
      validateDraft({
        ...bug,
        title: "x".repeat(161),
        description: "x".repeat(5001),
        details: "x".repeat(8001),
      }),
    ).toMatchObject({
      title: expect.any(String),
      description: expect.any(String),
      details: expect.any(String),
    });
  });
  it("does not silently derive priority or status from sparse information or moderation", () => {
    const baseline: ReportPatch = {
      status: "new",
      priority: "critical",
      information: "sparse",
      moderation: "pending",
      duplicate_of: null,
      admin_note: "",
    };
    expect(
      reportPatch(baseline as Report, { ...baseline, moderation: "approved" }),
    ).toEqual({ moderation: "approved" });
    expect(
      reportPatch(baseline as Report, { ...baseline, information: "detailed" }),
    ).toEqual({ information: "detailed" });
    expect(reportPatch(baseline as Report, baseline)).toEqual({});
    expect(
      reportPatch({ ...baseline, duplicate_of: "old-id" } as Report, baseline),
    ).toEqual({ duplicate_of: null });
  });
});
describe("bounded pagination", () => {
  it("normalizes invalid deep-link filters without exposing unknown select values", () => {
    expect(filterValue("project", "campus.evil", "votes")).toBe("");
    expect(filterValue("status", "published", "votes")).toBe("");
    expect(filterValue("sort", "priority", "votes")).toBe("votes");
    expect(filterValue("sort", "old", "new")).toBe("old");
    expect(filterValue("q", " x ", "votes")).toBe("x");
  });
  it.each([
    ["-30", "0"],
    ["NaN", "0"],
    ["Infinity", "0"],
    ["10000", "9990"],
    ["999999999", "9990"],
    ["44", "30"],
  ])("normalizes offset %s to %s", (offset, expected) => {
    const params = new URLSearchParams(
      listQuery({ offset, q: "текст & детали", project: "campus" }, "votes"),
    );
    expect(params.get("offset")).toBe(expected);
    expect(params.get("limit")).toBe("30");
    expect(params.get("q")).toBe("текст & детали");
    expect(params.get("sort")).toBe("votes");
  });
});
