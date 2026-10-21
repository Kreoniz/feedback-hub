import { expect, test } from "@playwright/test";
import { accessible, choose, noHorizontalOverflow } from "./helpers";

// Read-only fixtures isolate layout and closing motion from private inbox data.
test("compact inbox stretches rows and preserves the dialog exit transition", async ({
  page,
}) => {
  const report = {
    id: "00000000-0000-4000-8000-000000000001",
    project: "campus",
    project_name: "Кампус",
    title: "Показывать расписание сразу на всю неделю",
    description: "Хочу видеть пары на всю неделю без переключения дней.",
    type: "feature",
    status: "new",
    votes: 3,
    voted: false,
    created_at: "2026-10-21T00:00:00Z",
    updated_at: "2026-10-21T00:00:00Z",
    details: "",
    context: { browser: "Firefox", app_version: "v1" },
    moderation: "pending",
    priority: "untriaged",
    information: "useful",
    duplicate_of: null,
    admin_note: "",
  };
  await page.route("**/api/admin/**", (route) => {
    if (route.request().method() !== "GET") return route.abort();
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/session"))
      return route.fulfill({
        json: { authenticated: true, csrf_token: "layout-fixture" },
      });
    if (path.endsWith(`/reports/${report.id}`))
      return route.fulfill({ json: report });
    return route.fulfill({
      json: {
        items: [
          report,
          {
            ...report,
            id: "00000000-0000-4000-8000-000000000002",
            type: "bug",
            title: "",
            description: "После входа страница не открывается",
          },
        ],
        total: 2,
      },
    });
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/admin");
  const opener = page.getByRole("button", {
    name: `Открыть: ${report.title}`,
    exact: true,
  });
  await expect(opener).toBeVisible();
  await expect(page.getByText("ЛИЧНОЕ ПРОСТРАНСТВО")).toHaveCount(0);
  await expect(
    page.getByRole("combobox", { name: "Модерация", exact: true }),
  ).toHaveCount(0);
  const row = await opener.evaluate((button) => {
    const bounds = button.getBoundingClientRect();
    const summary = button
      .querySelector(".report-summary")!
      .getBoundingClientRect();
    const arrow = button
      .querySelector(".report-row > .icon")!
      .getBoundingClientRect();
    return {
      left: summary.left - bounds.left,
      width: summary.width / bounds.width,
      right: bounds.right - arrow.right,
      height: bounds.height,
      top: bounds.top,
    };
  });
  expect(row.left).toBeLessThan(80);
  expect(row.width).toBeGreaterThan(0.8);
  expect(row.right).toBeLessThan(30);
  expect(row.height).toBeLessThan(145);
  expect(row.top).toBeLessThan(300);
  await accessible(page);
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 740 });
    expect((await opener.boundingBox())!.y).toBeLessThan(420);
    await noHorizontalOverflow(page);
    await page.getByRole("button", { name: "Фильтры", exact: true }).click();
    await expect(
      page.getByRole("combobox", { name: "Информативность", exact: true }),
    ).toBeVisible();
    await noHorizontalOverflow(page);
    await accessible(page);
    await page
      .getByRole("button", { name: "Скрыть фильтры", exact: true })
      .click();
  }
  await page.goto("/admin?sort=priority");
  await expect(
    page.getByRole("combobox", { name: "Порядок", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Скрыть фильтры · 1", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Фильтры · 1", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Сбросить фильтры", exact: true })
    .click();
  await expect(page).not.toHaveURL(/sort=priority/);
  await expect(
    page.getByRole("button", { name: "Фильтры", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Сбросить фильтры", exact: true }),
  ).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await opener.click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByText(report.description, { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("textbox", { name: "Заметка администратора" }),
  ).toHaveCount(0);
  await expect(dialog.getByText("Firefox", { exact: true })).not.toBeVisible();
  await dialog.getByText("Технические сведения", { exact: true }).click();
  await expect(dialog.getByText("Firefox", { exact: true })).toBeVisible();
  await choose(page, "Приоритет", "Высокий");
  // Base UI can retain a closed Select portal; wait for it to leave the screen.
  await expect(
    page.getByRole("listbox", { includeHidden: true }),
  ).not.toBeVisible();
  await page.getByRole("button", { name: "Сохранить", exact: true }).focus();
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true,
  );
  await accessible(page);
  await page.getByRole("button", { name: "Отменить", exact: true }).click();
  await dialog.evaluate(async (el) => {
    await Promise.all(
      el.getAnimations().map((animation) => animation.finished),
    );
  });
  const closing = page.evaluate(async () => {
    const popup = document.querySelector(".report-dialog")!;
    const started = performance.now();
    const samples: { opacity: number; ending: boolean; content: boolean }[] =
      [];
    return await new Promise<{ samples: typeof samples; removed: boolean }>(
      (resolve) => {
        const sample = () => {
          if (!popup.isConnected || performance.now() - started > 4000) {
            resolve({ samples, removed: !popup.isConnected });
            return;
          }
          samples.push({
            opacity: Number(getComputedStyle(popup).opacity),
            ending: popup.hasAttribute("data-ending-style"),
            content: !!popup.querySelector(".admin-editor"),
          });
          requestAnimationFrame(sample);
        };
        sample();
      },
    );
  });
  await page
    .getByRole("button", { name: "Закрыть сообщение", exact: true })
    .click();
  const result = await closing;
  expect(result.removed).toBe(true);
  const exit = result.samples.filter((frame) => frame.ending);
  expect(exit.length).toBeGreaterThan(1);
  expect(exit.some((frame) => frame.opacity > 0 && frame.opacity < 1)).toBe(
    true,
  );
  expect(exit.every((frame) => frame.content)).toBe(true);
  await expect(opener).toBeFocused();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await opener.click();
  await expect(dialog).toBeVisible();
  expect(
    await dialog.evaluate((el) => getComputedStyle(el).transitionDuration),
  ).toMatch(/^0s(?:, 0s)*$/);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
});
