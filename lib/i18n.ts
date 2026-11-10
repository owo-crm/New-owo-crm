import pl from "../messages/pl.json" with { type: "json" };

/**
 * Простой переводчик без библиотек: t("auth.login.title") → «Zaloguj się».
 * Подстановки: t("today.greeting", { name: "Ivan" }) → «Cześć, Ivan!».
 * Ключи проверяются TypeScript'ом: опечатка в ключе = ошибка сборки.
 */
type Messages = typeof pl;

type Leaves<T, Prefix extends string = ""> = {
  [K in keyof T & string]: T[K] extends string ? `${Prefix}${K}` : Leaves<T[K], `${Prefix}${K}.`>;
}[keyof T & string];

export type MessageKey = Leaves<Messages>;

export function t(key: MessageKey, vars?: Record<string, string | number>): string {
  const value = key.split(".").reduce<unknown>((node, part) => {
    if (node && typeof node === "object" && part in node) {
      return (node as Record<string, unknown>)[part];
    }
    return undefined;
  }, pl);

  if (typeof value !== "string") return key;
  if (!vars) return value;
  return value.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}
