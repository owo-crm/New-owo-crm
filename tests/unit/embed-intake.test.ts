import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

/**
 * public/embed/v1.js — скрипт формы для сайтов клиентов (решение 034).
 * Запускается в «браузере» из подставных объектов: fetch, localStorage, таймеры.
 */
const SOURCE = readFileSync("public/embed/v1.js", "utf8");
const URL_OK = "https://crm.example.com/api/intake/4da707bf-0c67-419a-b0bf-15863d82047b";

type Call = { url: string; headers: Record<string, string>; body: URLSearchParams };
type Owo = {
  send(
    url: string,
    fields: Record<string, string>,
  ): Promise<{ ok: boolean; queued: boolean; id: string }>;
  flush(): Promise<number>;
  pending(): number;
};

function browser(options: { storage?: "ok" | "blocked"; now?: () => number } = {}) {
  const store = new Map<string, string>();
  const calls: Call[] = [];
  const responses: Array<() => Promise<Response>> = [];
  const localStorage =
    options.storage === "blocked"
      ? undefined
      : {
          getItem: (k: string) => store.get(k) ?? null,
          setItem: (k: string, v: string) => void store.set(k, v),
          removeItem: (k: string) => void store.delete(k),
        };
  const window: Record<string, unknown> = {
    URLSearchParams,
    AbortController,
    location: { href: "https://barowo.com/oferta/" },
    setTimeout: vi.fn(() => 1),
    clearTimeout: vi.fn(),
    addEventListener: vi.fn(),
    crypto: { randomUUID: () => "11111111-2222-4333-8444-555555555555" },
    fetch: (url: string, init: { headers: Record<string, string>; body: string }) => {
      calls.push({ url, headers: init.headers, body: new URLSearchParams(init.body) });
      const next = responses.shift();
      return next ? next() : Promise.resolve(Response.json({ ok: true }));
    },
  };
  if (options.storage === "blocked")
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new Error("SecurityError");
      },
    });
  else window.localStorage = localStorage;
  if (options.now) window.Date = { now: options.now };
  runInNewContext(SOURCE, {
    window,
    Date: options.now ? { now: options.now } : Date,
    Object,
    JSON,
    Promise,
    Error,
    Array,
    Math,
    String,
  });
  return {
    owo: window.OWO as Owo,
    calls,
    store,
    reply: (fn: () => Promise<Response>) => responses.push(fn),
  };
}

const down = () => Promise.reject(new TypeError("Failed to fetch"));

describe("embed v1.js", () => {
  it("принятая заявка: один запрос с submission_id в заголовке и в теле", async () => {
    const b = browser();
    const result = await b.owo.send(URL_OK, { name: "Łucja Żółć 🎉", phone: "600100200" });
    expect(result).toEqual({
      ok: true,
      queued: false,
      id: "owo-11111111-2222-4333-8444-555555555555",
    });
    expect(b.calls).toHaveLength(1);
    expect(b.calls[0].headers["Idempotency-Key"]).toBe(result.id);
    // строка без этого типа уходит как text/plain — intake ответит 400
    expect(b.calls[0].headers["Content-Type"]).toMatch(/^application\/x-www-form-urlencoded/);
    expect(b.calls[0].body.get("submission_id")).toBe(result.id);
    expect(b.calls[0].body.get("name")).toBe("Łucja Żółć 🎉");
    expect(b.calls[0].body.get("page_url")).toBe("https://barowo.com/oferta/");
    expect(b.owo.pending()).toBe(0);
  });

  it("CRM недоступна → заявка сохраняется и уходит позже с тем же submission_id", async () => {
    const b = browser();
    b.reply(down);
    const result = await b.owo.send(URL_OK, { name: "Anna", phone: "600100200" });
    expect(result.queued).toBe(true);
    expect(b.owo.pending()).toBe(1);

    b.reply(() => Promise.resolve(new Response("Bad gateway", { status: 502 })));
    expect(await b.owo.flush()).toBe(0); // всё ещё лежит
    expect(b.owo.pending()).toBe(1);

    expect(await b.owo.flush()).toBe(1); // CRM вернулась
    expect(b.owo.pending()).toBe(0);
    const ids = b.calls.map((c) => c.body.get("submission_id"));
    expect(new Set(ids).size).toBe(1); // повтор не создаст дубль в CRM
  });

  it("503 и 429 — ставим в очередь; 422 — отказ без повтора", async () => {
    const b = browser();
    b.reply(() =>
      Promise.resolve(Response.json({ error: "temporarily_unavailable" }, { status: 503 })),
    );
    expect((await b.owo.send(URL_OK, { name: "A", phone: "1" })).queued).toBe(true);
    b.reply(() => Promise.resolve(Response.json({ error: "consent_required" }, { status: 422 })));
    await expect(b.owo.send(URL_OK, { name: "B", phone: "2" })).rejects.toMatchObject({
      code: "consent_required",
    });
    expect(b.owo.pending()).toBe(1);
  });

  it("заявки старше 7 дней из очереди выбрасываются", async () => {
    let t = 1_000_000_000_000;
    const b = browser({ now: () => t });
    b.reply(down);
    await b.owo.send(URL_OK, { name: "A", phone: "1" });
    t += 8 * 24 * 60 * 60 * 1000;
    expect(await b.owo.flush()).toBe(0);
    expect(b.owo.pending()).toBe(0);
  });

  it("чужой адрес не принимается", async () => {
    const b = browser();
    await expect(b.owo.send("https://evil.example/collect", { a: "1" })).rejects.toMatchObject({
      code: "bad_url",
    });
    expect(b.calls).toHaveLength(0);
  });

  it("без доступа к localStorage при сбое — честная ошибка, а не ложное «отправлено»", async () => {
    const b = browser({ storage: "blocked" });
    b.reply(down);
    await expect(b.owo.send(URL_OK, { name: "A", phone: "1" })).rejects.toMatchObject({
      code: "unavailable",
    });
  });
});
