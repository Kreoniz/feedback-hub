import { existsSync } from "node:fs";
import { chromium, defineConfig, firefox } from "@playwright/test";

const requested = process.env.PLAYWRIGHT_BROWSER;
const browserName =
  requested === "chromium" || requested === "firefox" || requested === "webkit"
    ? requested
    : existsSync(chromium.executablePath())
      ? "chromium"
      : "firefox";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  retries: 0, // Retrying successful intake would consume the real network budget.
  timeout: 60000,
  expect: { timeout: 10000 },
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: process.env.FEEDBACK_TEST_URL || "http://localhost:18080",
    browserName,
    headless: true,
    viewport: { width: 390, height: 844 },
    locale: "ru-RU",
    reducedMotion: "reduce",
    // Artifacts are opt-in: traces and failed login screenshots can contain secrets.
    trace: "off",
    screenshot: "off",
    video: "off",
    ...(browserName === "chromium" && process.env.PLAYWRIGHT_EXECUTABLE_PATH
      ? {
          launchOptions: {
            executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH,
          },
        }
      : browserName === "firefox" &&
          !existsSync(firefox.executablePath()) &&
          process.env.PLAYWRIGHT_EXECUTABLE_PATH
        ? {
            launchOptions: {
              executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH,
            },
          }
        : {}),
  },
});
