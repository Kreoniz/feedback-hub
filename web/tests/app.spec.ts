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
  await page.setViewportSize({ width: 320, height: 568 });
  const editor = page.getByRole("dialog");
  await page.getByRole("button", { name: "Сохранить", exact: true }).focus();
  expect(await editor.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true,
  );
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.keyboard.press("Escape");
  await expect(editor).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Заметка администратора" }),
  ).toHaveValue(`${marker}-PRIVATE-NOTE`);
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

  // Publish the second existing fixture to verify independent cards, without extra intake.
  await page
    .getByRole("button", { name: `Открыть: ${originalTitle}`, exact: true })
    .click();
  await choose(page, "Модерация", "Одобрено");
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(
    page.getByText("Изменения сохранены.", { exact: true }).last(),
  ).toBeVisible();
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
    const targetCard = publicPage.locator(".feature-card").filter({
      has: publicPage.getByRole("button", { name: title, exact: true }),
    });
    const otherCard = publicPage.locator(".feature-card").filter({
      has: publicPage.getByRole("button", {
        name: originalTitle,
        exact: true,
      }),
    });
    const clickedButton = targetCard.locator(".vote-button");
    const clickedNode = await clickedButton.elementHandle();
    const housingNode = await clickedButton
      .locator(".u-physical-housing")
      .elementHandle();
    const appearance = await clickedButton.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        opacity: style.opacity,
        visibility: style.visibility,
        display: style.display,
      };
    });
    expect(appearance.opacity).toBe("1");
    async function expectStableVoteAppearance() {
      expect(
        await clickedButton.evaluate((element) => {
          const style = getComputedStyle(element);
          return {
            opacity: style.opacity,
            visibility: style.visibility,
            display: style.display,
          };
        }),
      ).toEqual(appearance);
      expect(
        await clickedButton.evaluate(
          (element, original) => element === original,
          clickedNode,
        ),
      ).toBe(true);
      expect(
        await clickedButton
          .locator(".u-physical-housing")
          .evaluate((element, original) => element === original, housingNode),
      ).toBe(true);
    }
    const sibling = otherCard.locator(".vote-button");
    const siblingNode = await sibling.elementHandle();
    const siblingHTML = await sibling.evaluate((el) => el.outerHTML);
    // Delay the outgoing real request, never fabricate a successful mutation response.
    let releaseVote!: () => void;
    const voteGate = new Promise<void>((resolve) => {
      releaseVote = resolve;
    });
    await publicPage.route(
      `**/api/features/${featureId}/vote`,
      async (route) => {
        await voteGate;
        await route.continue();
      },
    );
    try {
      await targetCard.getByRole("button", { name: /^Поддержать:/ }).click();
      await expect(targetCard.locator(".vote-button")).toHaveAttribute(
        "aria-busy",
        "true",
      );
      await expect(targetCard.locator(".vote-button")).toBeFocused();
      await expectStableVoteAppearance();
      await expect(sibling).toBeEnabled();
      expect(await sibling.evaluate((el) => el.outerHTML)).toBe(siblingHTML);
      expect(
        await sibling.evaluate((el, previous) => el === previous, siblingNode),
      ).toBe(true);
      await sibling.click();
      await expect(sibling).toHaveAttribute("aria-pressed", "true");
    } finally {
      releaseVote();
    }
    await expect(
      targetCard.getByRole("button", { name: /^Отменить голос:/ }),
    ).toBeEnabled();
    await publicPage.unroute(`**/api/features/${featureId}/vote`);
    await expectStableVoteAppearance();
    await expect(
      targetCard.getByRole("button", { name: /^Отменить голос:/ }),
    ).toBeEnabled();
    await publicPage.reload();
    await expect(
      targetCard.getByRole("button", { name: /^Отменить голос:/ }),
    ).toBeVisible();
    // A failed undo must retain the selected state, then a real DELETE removes only this vote.
    await publicPage.route("**/api/features/*/vote", (route) =>
      route.request().method() === "DELETE"
        ? route.abort("failed")
        : route.continue(),
    );
    await targetCard.getByRole("button", { name: /^Отменить голос:/ }).click();
    await expect(
      publicPage.getByText("Не удалось изменить голос", { exact: true }),
    ).toBeVisible();
    await expect(
      targetCard.getByRole("button", { name: /^Отменить голос:/ }),
    ).toHaveAttribute("aria-pressed", "true");
    await publicPage.unroute("**/api/features/*/vote");
    await targetCard.getByRole("button", { name: /^Отменить голос:/ }).click();
    await expect(
      targetCard.getByRole("button", { name: /^Поддержать:/ }),
    ).toHaveAttribute("aria-pressed", "false");
    await publicPage.reload();
    await expect(
      targetCard.getByRole("button", { name: /^Поддержать:/ }),
    ).toBeVisible();
    await targetCard.getByRole("button", { name: /^Поддержать:/ }).click();
    await expect(
      targetCard.getByRole("button", { name: /^Отменить голос:/ }),
    ).toHaveAttribute("aria-pressed", "true");
    const card = publicPage.locator(".feature-card").first();
    expect((await card.boundingBox())!.y).toBeLessThan(350);
    await expect(
      card.getByRole("link", { name: "Marvin Campus" }),
    ).toHaveAttribute("href", "https://campus.kreoniz.ru/");
    await expect(
      card.getByRole("link", { name: "Marvin Campus" }).locator("img"),
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
      publicPage.getByRole("button", { name: title, exact: true }),
    ).toHaveCount(0);
    await expect(
      publicPage.getByRole("button", { name: originalTitle, exact: true }),
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
