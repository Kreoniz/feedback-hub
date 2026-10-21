import type { Project } from "./domain";
import { ProjectIcon } from "./projects";

export function ProjectLink({
  project,
  slug,
  name,
}: {
  project?: Project;
  slug: string;
  name: string;
}) {
  // The package page is the verified public entry point until UI docs have a domain.
  const candidate =
    project?.url ||
    (slug === "unlikely-ui" ? "https://www.npmjs.com/package/unlikely-ui" : "");
  let href = "";
  try {
    const url = new URL(candidate);
    if (["https:", "http:"].includes(url.protocol)) href = url.href;
  } catch {
    /* Projects without a public destination remain plain labels. */
  }
  const content = (
    <>
      <ProjectIcon slug={slug} />
      <span>{name}</span>
      {href && (
        <svg
          className="project-arrow"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
        >
          <path d="M4 12 12 4M5 4h7v7" />
        </svg>
      )}
    </>
  );
  return href ? (
    <a
      className="project-link"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
    >
      {content}
    </a>
  ) : (
    <span className="project-link">{content}</span>
  );
}
