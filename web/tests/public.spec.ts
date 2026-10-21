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
    "Что улучшить дальше?",
  );
  await expect(page.getByText(/^Найдено:/)).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Перейти к содержимому" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main")).toBeFocused();
  await choose(page, "Проект", "Marvin Campus");
  await expect(page).toHaveURL(/project=campus/);
  await page
    .getByRole("searchbox", { name: "Поиск идей" })
    .fill("несуществующая-идея-e2e");
  await expect(
    page.getByRole("heading", { name: "Ничего не нашлось" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Сбросить фильтры" }).click();
  await expect(page.getByRole("searchbox", { name: "Поиск идей" })).toHaveValue(
    "",
  );
  await noHorizontalOverflow(page);
  await accessible(page);
  await page.getByRole("button", { name: "Включить тёмную тему" }).click();
  await accessible(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await noHorizontalOverflow(page);
  await page.goto("/new?project=campus&type=bug");
  await expect(
    page.getByRole("heading", { name: "Расскажите об ошибке." }),
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
  expect(await page.getByRole("textbox", { name: "Что случилось?" }).evaluate(el => getComputedStyle(el).fontSize)).toBe("16px");
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
