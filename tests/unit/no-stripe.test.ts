import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * D-23: Stripe полностью удалён из приложения. Тест не даёт вернуть интеграцию незаметно:
 * нет маршрута вебхука, нет клиента Stripe API, нет Checkout/портала, нет переменных STRIPE_*.
 * Исторические упоминания (колонки stripe_* в SQL, отчёты по истории) — в белом списке.
 */
const root = path.resolve(__dirname, "../..");
const SCAN = [
  "app",
  "components",
  "lib",
  "proxy.ts",
  "next.config.ts",
  "package.json",
  ".env.example",
];
// Файлы, где «stripe» встречается только как ИСТОРИЯ данных (колонки, отчёты), без вызовов API.
const HISTORY_ONLY = new Set([
  "lib/platform/org-relations-report.ts",
]);

function files(p: string): string[] {
  const full = path.join(root, p);
  if (!existsSync(full)) return [];
  if (statSync(full).isFile()) return [p];
  return readdirSync(full).flatMap((f) => files(path.join(p, f)));
}

describe("Stripe удалён (D-23)", () => {
  it("нет маршрута вебхука и клиента Stripe", () => {
    expect(existsSync(path.join(root, "app/api/stripe"))).toBe(false);
    expect(existsSync(path.join(root, "lib/billing/stripe.ts"))).toBe(false);
    expect(existsSync(path.join(root, "components/billing/portal-button.tsx"))).toBe(false);
  });

  it("в коде приложения нет Stripe API, Checkout, портала и переменных STRIPE_*", () => {
    const offenders = SCAN.flatMap(files)
      .filter((f) => /\.(tsx?|json|example)$/.test(f) && !HISTORY_ONLY.has(f))
      .filter((f) =>
        /stripe|checkout\.session|billing_portal|STRIPE_/i.test(
          readFileSync(path.join(root, f), "utf8"),
        ),
      );
    expect(offenders).toEqual([]);
  });

  it("действия Checkout и портала больше не экспортируются", () => {
    const actions = readFileSync(path.join(root, "lib/billing/actions.ts"), "utf8");
    expect(actions).not.toMatch(/checkoutLinkAction|openPortalAction/);
  });
});
