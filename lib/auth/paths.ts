/** Страницы, доступные без входа. Всё остальное требует логина. */
const PUBLIC_PREFIXES = [
  "/logowanie",
  "/rejestracja",
  "/reset-hasla",
  "/nowe-haslo",
  "/o/",
  "/api/",
  "/sw.js",
];
/** Страницы входа: вошедшего пользователя с них уводим в приложение. */
export const AUTH_PAGES = ["/logowanie", "/rejestracja", "/reset-hasla"];

export function isPublicPath(pathname: string) {
  return PUBLIC_PREFIXES.some((prefix) => {
    const base = prefix.replace(/\/$/, "");
    // точное совпадение или вложенный путь: /logowanie, /api/intake — но не /logowaniex
    return pathname === base || pathname.startsWith(base + "/");
  });
}
