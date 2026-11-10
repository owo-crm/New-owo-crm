const POLISH_MAP: Record<string, string> = {
  ą: "a",
  ć: "c",
  ę: "e",
  ł: "l",
  ń: "n",
  ó: "o",
  ś: "s",
  ź: "z",
  ż: "z",
};

/**
 * Делает из названия фирмы короткий адрес: «Bar Łódź & Co.» → «bar-lodz-co».
 * Уникальность (добавление суффикса) проверяет база в функции create_organization.
 */
export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[ąćęłńóśźż]/g, (ch) => POLISH_MAP[ch] ?? ch)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
  return slug || "firma";
}
