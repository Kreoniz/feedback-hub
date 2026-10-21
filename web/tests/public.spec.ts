import { expect, test } from "@playwright/test";
import { accessible, choose, noHorizontalOverflow } from "./helpers";

test.use({ hasTouch: true });

test("public screens: mobile and desktop, keyboard, theme, filters and axe", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Предложения",
  );
  await expect(page.getByText(/^Найдено:/)).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Перейти к содержимому" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main")).toBeFocused();
  await choose(page, "Проект", "Кампус");
  await expect(page).toHaveURL(/project=campus/);
  await page
    .getByRole("searchbox", { name: "Поиск предложений" })
    .fill("несуществующая-идея-e2e");
  await expect(
    page.getByRole("heading", { name: "Ничего не нашлось" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Сбросить фильтры" }).click();
  await expect(
    page.getByRole("searchbox", { name: "Поиск предложений" }),
  ).toHaveValue("");
  // Read-only pagination fixture: real mutation scenarios remain in app.spec.ts.
  await page.route("**/api/features?**", (route) => {
    const offset = Number(
      new URL(route.request().url()).searchParams.get("offset"),
    );
    const items = Array.from({ length: offset ? 1 : 30 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index + offset + 1).padStart(12, "0")}`,
      project: "campus",
      project_name: "Кампус",
      title: `Предложение ${index + offset + 1}`,
      description: "Проверка клавиатурной навигации.",
      status: "new",
      votes: 0,
      voted: false,
      created_at: "2026-10-21T00:00:00Z",
    }));
    return route.fulfill({ json: { items, total: 31 } });
  });
  await page.reload();
  await expect(page.getByText("Найдено: 31")).toBeVisible();
  await page.getByRole("button", { name: "Дальше", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/offset=30/);
  const paginationHeading = page.getByRole("heading", {
    name: "Предложения",
    exact: true,
  });
  await expect(paginationHeading).toBeFocused();
  expect(
    await paginationHeading.evaluate((element) => {
      const style = getComputedStyle(element);
      return (
        style.outlineStyle !== "none" && parseFloat(style.outlineWidth) >= 2
      );
    }),
  ).toBe(true);
  await page.unroute("**/api/features?**");
  await page.goto("/");
  await expect(page.getByText(/^Найдено:/)).toBeVisible();
  await noHorizontalOverflow(page);
  await accessible(page);
  await page
    .getByRole("button", { name: "Как это работает", exact: true })
    .click();
  await expect(
    page.getByText("Предложения публикуются после проверки.", { exact: false }),
  ).toBeVisible();
  await page.getByText("Голосование и приватность", { exact: true }).click();
  await expect(
    page.getByText("Голос связан с cookie", { exact: false }),
  ).toBeVisible();
  await noHorizontalOverflow(page);
  await accessible(page);
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Как это работает", exact: true }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Включить тёмную тему" }).click();
  await accessible(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await noHorizontalOverflow(page);
  await page.goto("/new?project=campus&type=bug");
  await expect(
    page.getByRole("heading", { name: "Обратная связь" }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Название идеи" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("textbox", { name: "Дополнительные детали" }),
  ).not.toBeVisible();
  await expect(
    page.getByText(/Добавим безопасные сведения о браузере/),
  ).toBeVisible();
  await page.setViewportSize({ width: 320, height: 740 });
  expect(
    await page
      .getByRole("textbox", { name: "Что случилось?" })
      .evaluate((el) => getComputedStyle(el).fontSize),
  ).toBe("16px");
  await noHorizontalOverflow(page);
  await accessible(page);
  await page.getByText("Добавить подробности", { exact: false }).click();
  await expect(
    page.getByRole("checkbox", { name: /Приложить технический контекст/ }),
  ).toBeChecked();
  await page
    .getByRole("checkbox", { name: /Приложить технический контекст/ })
    .uncheck();
  await expect(page.getByText("Технический контекст отключён.")).toBeVisible();
  await page.goto("/admin");
  await expect(
    page.getByRole("heading", { name: "Вход во входящие" }),
  ).toBeVisible();
  await noHorizontalOverflow(page);
  await accessible(page);
  expect(errors).toEqual([]);
});

test("skeletons replace initial and list loading; project icons stay in menu and trigger", async ({
  page,
}) => {
  let releaseProjects!: () => void;
  let releaseFeatures!: () => void;
  const projectsGate = new Promise<void>((resolve) => {
    releaseProjects = resolve;
  });
  const featuresGate = new Promise<void>((resolve) => {
    releaseFeatures = resolve;
  });
  await page.route("**/api/projects", async (route) => {
    await projectsGate;
    await route.continue();
  });
  await page.route("**/api/features?**", async (route) => {
    await featuresGate;
    await route.continue();
  });
  try {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("region", { name: "Загрузка предложений" }),
    ).toBeVisible();
    await expect(page.locator(".skeleton-card")).toHaveCount(3);
    await expect(page.locator(".u-spinner")).toHaveCount(0);
    await noHorizontalOverflow(page);
    await accessible(page);
    releaseProjects();
    await expect(
      page.getByRole("heading", { name: "Предложения", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".loading-cards")).toBeVisible();
    await expect(page.locator(".skeleton-card")).toHaveCount(3);
    releaseFeatures();
    await expect(page.getByText(/^Найдено:/)).toBeVisible();
    await expect(page.locator(".skeleton-card")).toHaveCount(0);
  } finally {
    releaseProjects();
    releaseFeatures();
  }
  await page.getByRole("combobox", { name: "Проект", exact: true }).click();
  for (const [name, asset] of [
    ["Кампус", "campus.png"],
    ["Unlikely UI", "unlikely-ui.png"],
    ["Другое", "other.svg"],
  ]) {
    const icon = page.getByRole("option", { name, exact: true }).locator("img");
    await expect(icon).toBeVisible();
    await expect(icon).toHaveAttribute("src", `/projects/${asset}`);
    expect(
      await icon.evaluate(
        (el: HTMLImageElement) => el.complete && el.naturalWidth > 0,
      ),
    ).toBe(true);
  }
  await accessible(page);
  await page
    .getByRole("option", { name: "Кампус", exact: true })
    .click();
  await expect(
    page.getByRole("combobox", { name: "Проект", exact: true }).locator("img"),
  ).toHaveAttribute("src", "/projects/campus.png");
  await page.setViewportSize({ width: 320, height: 740 });
  await noHorizontalOverflow(page);
  await page.getByRole("combobox", { name: "Проект", exact: true }).click();
  await accessible(page);
});
