import type { Project } from "./domain";

const icons: Record<string, string> = {
  campus: "/projects/campus.png",
  "unlikely-ui": "/projects/unlikely-ui.png",
  other: "/projects/other.svg",
};

export function ProjectIcon({ slug }: { slug: string }) {
  return (
    <img
      className="project-icon"
      src={icons[slug] || icons.other}
      width="20"
      height="20"
      alt=""
    />
  );
}

export function projectChoices(
  projects: Project[],
  placeholder = "Все проекты",
) {
  return [
    { value: "", label: placeholder, icon: <ProjectIcon slug="" /> },
    ...projects.map((project) => ({
      value: project.slug,
      label: project.name,
      icon: <ProjectIcon slug={project.slug} />,
    })),
  ];
}
