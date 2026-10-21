import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, expiredFormToken, request } from "./api";

afterEach(() => vi.unstubAllGlobals());
describe("API transport", () => {
  it("uses same-origin cookies, no-store and explicit CSRF for admin mutations", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ id: "report" }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetch);
    await api.patch("id/unsafe", { priority: "critical" }, "csrf-private");
    expect(fetch).toHaveBeenCalledWith(
      "/api/admin/reports/id%2Funsafe",
      expect.objectContaining({
        method: "PATCH",
        credentials: "same-origin",
        cache: "no-store",
        body: '{"priority":"critical"}',
        headers: expect.objectContaining({
          "X-CSRF-Token": "csrf-private",
          "Content-Type": "application/json",
        }),
      }),
    );
  });
  it("never retries a failed mutation automatically", async () => {
    const fetch = vi
      .fn()
      .mockRejectedValue(new TypeError("network disconnected"));
    vi.stubGlobal("fetch", fetch);
    await expect(api.vote("id")).rejects.toMatchObject({ status: 0 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("preserves a safe server message and Retry-After on rate limit", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ error: "Слишком много запросов." }), {
            status: 429,
            headers: { "Retry-After": "60" },
          }),
        ),
    );
    await expect(api.vote("id")).rejects.toMatchObject({
      status: 429,
      retryAfter: 60,
      message: "Слишком много запросов. Повторите через 60 с.",
    });
  });
  it("handles no-content logout and non-JSON server failures", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        new Response("<html>proxy failed</html>", { status: 502 }),
      );
    vi.stubGlobal("fetch", fetch);
    await expect(api.logout("csrf")).resolves.toBeUndefined();
    await expect(request("/features")).rejects.toMatchObject({
      status: 502,
      message: expect.not.stringContaining("<html>"),
    });
  });
  it("recognizes the backend expiry message without treating other validation errors as token expiry", () => {
    expect(
      expiredFormToken(
        new ApiError(
          "Срок действия формы истёк или форма ещё не готова. Обновите форму и повторите отправку",
          400,
        ),
      ),
    ).toBe(true);
    expect(
      expiredFormToken(
        new ApiError(
          "Подождите две секунды или обновите форму и повторите отправку",
          400,
        ),
      ),
    ).toBe(true);
    expect(
      expiredFormToken(new ApiError("Проверьте технический контекст", 400)),
    ).toBe(false);
    expect(
      expiredFormToken(new ApiError("Срок действия формы истёк", 500)),
    ).toBe(false);
  });
});
