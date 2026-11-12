import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";

/**
 * Регрессия: просроченная cookie сессии однажды закольцевала вход.
 * Прокси уводил с /logowanie на /dzisiaj по одному наличию cookie, а requireUser()
 * возвращал обратно, потому что сессии в базе уже не было — ERR_TOO_MANY_REDIRECTS.
 * Поэтому решение «вошёл или нет» принимает страница, которая смотрит в базу, а не прокси.
 */

const request = (path: string, cookie?: string) =>
  new NextRequest(new URL(path, "https://crm.example"), {
    headers: cookie ? { cookie } : undefined,
  });

const STALE = "owo_session=deadbeefdeadbeefdeadbeefdeadbeef";

describe("proxy", () => {
  it("не уводит с экрана входа, даже когда cookie есть", () => {
    for (const path of ["/logowanie", "/rejestracja", "/reset-hasla"]) {
      const response = proxy(request(path, STALE));
      expect(response.headers.get("location"), path).toBeNull();
    }
  });

  it("закрытую страницу без cookie отправляет на вход и помнит, куда шли", () => {
    const response = proxy(request("/leady/123", undefined));
    const location = response.headers.get("location");
    expect(location).toContain("/logowanie");
    expect(location).toContain("next=%2Fleady%2F123");
  });

  it("закрытую страницу с cookie пропускает — сессию проверяет сама страница", () => {
    expect(proxy(request("/dzisiaj", STALE)).headers.get("location")).toBeNull();
  });

  it("приём заявок открыт без входа", () => {
    expect(proxy(request("/api/intake/abc")).headers.get("location")).toBeNull();
  });
});
