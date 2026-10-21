import { Component, StrictMode, useState } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { Button } from "unlikely-ui/button";
import { Theme } from "unlikely-ui/theme";
import "unlikely-ui/styles.css";
import "./styles.css";
import { Admin } from "./Admin";
import { Board } from "./Board";
import { Help } from "./Help";
import { NewReport } from "./NewReport";
import { api } from "./api";
import { useResource } from "./hooks";
import { ErrorNotice, Icon, Loading } from "./ui";

const loadProjects = (signal: AbortSignal) => api.projects(signal);

function App() {
  const projects = useResource(loadProjects);
  const [appearance, setAppearance] = useState<"light" | "dark">("light");
  const path = window.location.pathname.replace(/\/$/, "") || "/";
  const admin = path === "/admin";
  return (
    <Theme
      appearance={appearance}
      className="app-theme"
      tokens={{
        "--u-font": "'Inter', ui-sans-serif, system-ui, sans-serif",
        "--u-font-display": "'Inter', ui-sans-serif, system-ui, sans-serif",
        "--u-panel-radius": "16px",
        "--u-dialog-radius": "20px",
        "--u-radius": "8px",
      }}
    >
      <a className="skip-link" href="#main">
        Перейти к содержимому
      </a>
      <header className="site-header">
        <div className="header-inner">
          <a className="brand" href="/" aria-label="Feedback Hub — предложения">
            <img
              className="brand-mark"
              src="/feedback-bulb.png"
              width="40"
              height="40"
              alt=""
            />
            <span>Feedback Hub</span>
          </a>
          <nav className="header-nav" aria-label="Основная навигация">
            <Help />
            <Button
              variant="ghost"
              size="icon"
              aria-label={
                appearance === "light"
                  ? "Включить тёмную тему"
                  : "Включить светлую тему"
              }
              onClick={() =>
                setAppearance((current) =>
                  current === "light" ? "dark" : "light",
                )
              }
            >
              <Icon name={appearance === "light" ? "moon" : "sun"} />
            </Button>
          </nav>
        </div>
      </header>
      <main
        id="main"
        className={`main-container ${admin ? "admin-container" : ""}`}
        tabIndex={-1}
      >
        <Boundary>
          {projects.loading ? (
            <Loading label="Загружаем проекты" />
          ) : projects.error ? (
            <ErrorNotice error={projects.error} retry={projects.reload} />
          ) : (
            projects.data &&
            (path === "/" ? (
              <Board projects={projects.data.projects} />
            ) : path === "/new" ? (
              <NewReport projects={projects.data.projects} />
            ) : admin ? (
              <Admin projects={projects.data.projects} />
            ) : (
              <div className="empty-state">
                <h1>Страница не найдена</h1>
                <p className="muted">Возможно, адрес изменился.</p>
                <Button render={<a href="/" />} nativeButton={false}>
                  К доске идей
                </Button>
              </div>
            ))
          )}
        </Boundary>
      </main>
    </Theme>
  );
}

class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(_error: Error, _info: ErrorInfo) {
    /* Do not log report contents or session data. */
  }
  render() {
    if (this.state.failed)
      return (
        <div className="empty-state" role="alert">
          <h1>Не удалось открыть страницу</h1>
          <p>Обновите вкладку, чтобы попробовать ещё раз.</p>
          <Button onClick={() => window.location.reload()}>
            Обновить страницу
          </Button>
        </div>
      );
    return this.props.children;
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
