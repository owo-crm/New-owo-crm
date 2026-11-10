import { z } from "zod";
import { t } from "@/lib/i18n";
import { PRESET_KEYS } from "@/lib/presets";

/** Схемы проверки форм. Одни и те же правила для сервера и тестов. Ошибки — по-польски. */

const email = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: t("auth.validation.emailInvalid") }));

/** Логин: имя пользователя (a–z, 0–9, . _ -) или e-mail. Хранится в auth.users.email. */
const login = z
  .string()
  .trim()
  .toLowerCase()
  .refine((v) => /^[a-z0-9._-]{3,32}$/.test(v) || z.email().safeParse(v).success, {
    error: t("auth.validation.loginInvalid"),
  });

export const signInSchema = z.object({
  email: login,
  password: z.string().min(1, { error: t("auth.validation.passwordRequired") }),
  next: z.string().optional(),
});

export const newPasswordSchema = z.object({
  password: z
    .string()
    .min(10, { error: t("auth.validation.passwordShort") })
    .max(128),
});

export const signUpSchema = z.object({
  email: login,
  password: newPasswordSchema.shape.password,
  terms: z.literal("on", { error: t("auth.validation.termsRequired") }),
});

export const resetSchema = z.object({ email });

export const createOrganizationSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, { error: t("onboarding.company.nameRequired") })
    .max(120, { error: t("onboarding.company.nameRequired") }),
  preset: z.enum(PRESET_KEYS),
});

/** Только относительные внутренние пути — защита от перенаправления на чужой сайт. */
export function safeNextPath(next: string | null | undefined, fallback = "/dzisiaj"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) {
    return fallback;
  }
  return next;
}

export type FieldErrors = Partial<Record<string, string>>;

/** Первая ошибка по каждому полю — для показа под инпутом. */
export function fieldErrors(error: z.ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}
