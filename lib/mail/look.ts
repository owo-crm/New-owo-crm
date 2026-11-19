import { one, type Queryable } from "../db/core.ts";
import { DEFAULT_LOOK, type LetterLook } from "../mailing/render.ts";

/**
 * Внешний вид писем фирмы (решение 051): тема, цвет, подпись из настроек почты
 * и логотип кабинета по публичному адресу /api/logo/<id> (картинка в письме должна
 * открываться у клиента без входа в CRM).
 */
export async function loadLetterLook(
  db: Queryable,
  organizationId: string,
  origin: string,
): Promise<LetterLook> {
  const row = await one<{
    letter_theme: LetterLook["theme"] | null;
    letter_accent: string | null;
    letter_signature: string | null;
    logo_version: number | null;
  }>(
    db,
    `select s.letter_theme, s.letter_accent, s.letter_signature,
            (select extract(epoch from a.updated_at)::int from public.organization_avatars a
              where a.organization_id = o.id) as logo_version
       from public.organizations o
       left join public.organization_mail_settings s on s.organization_id = o.id
      where o.id = $1`,
    [organizationId],
  );
  if (!row) return DEFAULT_LOOK;
  // Картинка в письме имеет смысл только с настоящего https-адреса (не localhost).
  const publicOrigin = /^https:\/\//.test(origin) ? origin.replace(/\/$/, "") : null;
  return {
    theme: row.letter_theme ?? DEFAULT_LOOK.theme,
    accent: row.letter_accent ?? DEFAULT_LOOK.accent,
    signature: row.letter_signature ?? "",
    logoUrl:
      row.logo_version && publicOrigin
        ? `${publicOrigin}/api/logo/${organizationId}?v=${row.logo_version}`
        : null,
  };
}
