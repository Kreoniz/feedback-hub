import { expect, test } from "@playwright/test";
import { accessible, choose, noHorizontalOverflow, send } from "./helpers";

// This single real-backend scenario creates THREE reports, below the six/hour
// per-network production budget. It never mocks a successful API response.
test("real intake, retained network-error draft, moderation, anonymous vote, duplicates and spam", async ({
  page,
  browser,
  baseURL,
}) => {
  test.setTimeout(120000);
  const password = process.env.FEEDBACK_TEST_PASSWORD;
  test.skip(
    !password,
    "Set FEEDBACK_TEST_PASSWORD for the isolated test backend. Never use production.",
  );
  const marker = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const bugText = `${marker} — не открывается расписание`;
  const title = `${marker} — расписание на неделю`;
  const originalTitle = `${marker} — оригинал`;
  const privateDetails = `${marker}-PRIVATE-DETAILS`;

  await page.goto(
    "/new?project=campus&type=bug&source=https%3A%2F%2Fcampus.kreoniz.ru%2Fschedule%3Ftoken%3DPRIVATE%23student&app_version=v1.2.0",
  );
  await page.getByRole("textbox", { name: "Что случилось?" }).fill(bugText);
  // Fault injection only: the failed request never reaches the server. A later
  // user click performs the real POST and verifies the server's actual result.
  await page.route("**/api/reports", (route) => route.abort("failed"));
  const sendButton = page.getByRole("button", {
    name: "Отправить сообщение",
    exact: true,
  });
  await expect(sendButton).toBeEnabled();
  await sendButton.click();
  await expect(
    page.getByText("Не удалось отправить сообщение", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Что случилось?" }),
  ).toHaveValue(bugText);
  await page.unroute("**/api/reports");
  const outgoing = page.waitForRequest(
    (request) =>
      request.url().endsWith("/api/reports") && request.method() === "POST",
  );
  await send(page);
  const body = (await outgoing).postDataJSON();
  expect(body).not.toHaveProperty("title");
  expect(body.context).toMatchObject({
    page_url: "https://campus.kreoniz.ru/schedule",
    app_version: "v1.2.0",
  });
  expect(JSON.stringify(body)).not.toContain("PRIVATE");

  await page.goto("/new?project=campus");
  await page.getByRole("textbox", { name: "Название идеи" }).fill(title);
  await page
    .getByRole("textbox", { name: "Описание идеи" })
    .fill("Показывать расписание сразу на всю неделю.");
  await page.getByText("Добавить подробности", { exact: false }).click();
  await page
    .getByRole("textbox", { name: "Дополнительные детали" })
    .fill(privateDetails);
  await send(page);
  const pendingPublic = await page.request.get(
    `/api/features?q=${encodeURIComponent(marker)}`,
  );
  expect((await pendingPublic.json()).items).toEqual([]);

  await page.goto("/new?project=campus");
  await page
    .getByRole("textbox", { name: "Название идеи" })
    .fill(originalTitle);
  await page
    .getByRole("textbox", { name: "Описание идеи" })
    .fill("Оригинальное предложение для проверки связи дубликатов.");
  await send(page);

  await page.goto("/admin");
  await page.getByLabel("Пароль", { exact: true }).fill(password!);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Входящие", exact: true }),
  ).toBeVisible();
  await page.getByRole("searchbox", { name: "Поиск сообщений" }).fill(marker);
  await expect(
    page.getByRole("button", { name: `Открыть: ${title}`, exact: true }),
  ).toBeVisible();
  const adminList = await page.request.get(
    `/api/admin/reports?q=${encodeURIComponent(marker)}`,
  );
  const items = (await adminList.json()).items as {
    id: string;
    title: string;
    description: string;
  }[];
  const featureId = items.find((item) => item.title === title)!.id;
  const originalId = items.find((item) => item.title === originalTitle)!.id;
  const bugId = items.find((item) => item.description === bugText)!.id;
  await page
    .getByRole("button", { name: `Открыть: ${title}`, exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await choose(page, "Приоритет", "Критический");
  await choose(page, "Статус", "В планах");
  await choose(page, "Модерация", "Одобрено");
  await expect(
    page.getByText("Проверьте перед публикацией", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("ПУБЛИЧНОЕ НАЗВАНИЕ")).toBeVisible();
  await page
    .getByRole("textbox", { name: "Заметка администратора" })
    .fill(`${marker}-PRIVATE-NOTE`);
  await noHorizontalOverflow(page);
  await accessible(page);
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(
    page.getByText("Изменения сохранены.", { exact: true }).last(),
  ).toBeVisible();
  const edited = await (
    await page.request.get(`/api/admin/reports/${featureId}`)
  ).json();
  expect(edited).toMatchObject({
    priority: "critical",
    information: "sparse",
    moderation: "approved",
    status: "planned",
  });
  await page.getByRole("button", { name: "Закрыть сообщение" }).click();

  const visitor = await browser.newContext({
    baseURL,
    viewport: { width: 390, height: 844 },
    locale: "ru-RU",
  });
  try {
    const publicPage = await visitor.newPage();
    await publicPage.goto(`/?project=campus&q=${encodeURIComponent(marker)}`);
    await expect(
      publicPage.getByRole("button", { name: title, exact: true }),
    ).toBeVisible();
    const publicJSON = await (
      await publicPage.request.get(
        `/api/features?q=${encodeURIComponent(marker)}`,
      )
    ).text();
    expect(publicJSON).not.toContain("PRIVATE");
    expect(publicJSON).not.toContain(bugText);
    await publicPage.getByRole("button", { name: /^Поддержать:/ }).click();
    await expect(
      publicPage.getByRole("button", { name: /^Вы поддержали:/ }),
    ).toBeDisabled();
    await publicPage.reload();
    await expect(
      publicPage.getByRole("button", { name: /^Вы поддержали:/ }),
    ).toBeVisible();
    await publicPage.getByRole("button", { name: title, exact: true }).click();
    await expect(publicPage.getByRole("dialog")).toBeVisible();
    await accessible(publicPage);
    await publicPage.keyboard.press("Escape");
    await expect(
      publicPage.getByRole("button", { name: title, exact: true }),
    ).toBeFocused();
    await page
      .getByRole("button", { name: `Открыть: ${title}`, exact: true })
      .click();
    await page.getByText("Связь с оригиналом", { exact: false }).click();
    await page
      .getByRole("textbox", { name: "ID оригинального сообщения" })
      .fill(originalId);
    await page.getByRole("button", { name: "Сохранить", exact: true }).click();
    await expect(
      page.getByText("Изменения сохранены.", { exact: true }).last(),
    ).toBeVisible();
    expect(
      (await (await page.request.get(`/api/admin/reports/${featureId}`)).json())
        .duplicate_of,
    ).toBe(originalId);
    await page.getByRole("button", { name: "Закрыть сообщение" }).click();
    await publicPage.reload();
    await expect(
      publicPage.getByRole("heading", { name: "Ничего не нашлось" }),
    ).toBeVisible();
  } finally {
    await visitor.close();
  }

  await page
    .getByRole("button", { name: `Открыть: ${bugText}`, exact: true })
    .click();
  await page.getByRole("combobox", { name: "Модерация", exact: true }).click();
  await expect(
    page.getByRole("option", { name: "Одобрено", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("option", { name: "Спам", exact: true }).click();
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(
    page.getByText("Изменения сохранены.", { exact: true }).last(),
  ).toBeVisible();
  const privateBug = await (
    await page.request.get(`/api/admin/reports/${bugId}`)
  ).json();
  expect(privateBug.moderation).toBe("spam");
  expect(privateBug.context).toMatchObject({
    page_url: "https://campus.kreoniz.ru/schedule",
    app_version: "v1.2.0",
  });
  await page.getByRole("button", { name: "Закрыть сообщение" }).click();
  await page.getByRole("button", { name: "Выйти", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Вход во входящие" }),
  ).toBeVisible();
});
