"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { appConfig } from "@/lib/config";
import { t } from "@/lib/i18n";
import { sendSystemEmail } from "@/lib/notify/system-email";
import {
  fieldErrors,
  newPasswordSchema,
  resetSchema,
  safeNextPath,
  signInSchema,
  signUpSchema,
  type FieldErrors,
} from "@/lib/auth/schemas";
import {
  authenticate,
  createPasswordReset,
  createSession,
  createUser,
  deleteSession,
  EmailTakenError,
  resetPassword,
} from "./repository";
import { ORG_COOKIE, SESSION_COOKIE } from "./session";

/**
 * Действия форм входа/регистрации (выполняются на сервере).
 * Возвращают состояние формы: ошибки полей, общее сообщение или успех.
 */
export type FormState = {
  errors?: FieldErrors;
  message?: string;
  ok?: boolean;
  email?: string;
};

async function startSession(userId: string) {
  const db = getDb();
  const { token, expiresAt } = await createSession(db, userId, (await headers()).get("user-agent"));
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function signIn(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = signInSchema.safeParse(Object.fromEntries(formData));
  const email = String(formData.get("email") ?? "");
  if (!parsed.success) return { errors: fieldErrors(parsed.error), email };

  const userId = await authenticate(getDb(), parsed.data.email, parsed.data.password);
  if (!userId) return { message: t("auth.login.invalid"), email };
  await startSession(userId);
  redirect(safeNextPath(parsed.data.next));
}

export async function signUp(_prev: FormState, formData: FormData): Promise<FormState> {
  if (!appConfig.registrationOpen) return { message: t("auth.register.closed") };
  const parsed = signUpSchema.safeParse(Object.fromEntries(formData));
  const email = String(formData.get("email") ?? "");
  if (!parsed.success) return { errors: fieldErrors(parsed.error), email };

  try {
    const userId = await createUser(getDb(), { ...parsed.data, fullName: parsed.data.email });
    await startSession(userId);
  } catch (error) {
    if (error instanceof EmailTakenError)
      return { message: t("auth.register.alreadyRegistered"), email };
    console.error("[auth] signup", (error as Error).message);
    return { message: t("common.unknownError"), email };
  }
  redirect("/firma");
}

export async function requestPasswordReset(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = resetSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  try {
    const token = await createPasswordReset(getDb(), parsed.data.email);
    if (token) {
      const url = `${appConfig.siteUrl}/nowe-haslo?token=${encodeURIComponent(token)}`;
      await sendSystemEmail({
        to: parsed.data.email,
        subject: t("auth.reset.emailSubject"),
        text: `${t("auth.reset.emailBody")}\n\n${url}`,
        devLog: `[auth] link resetu hasła: ${url}`,
      });
    }
  } catch (error) {
    console.error("[auth] reset", (error as Error).message);
  }
  // Всегда одинаковый ответ — нельзя узнать, есть ли такой аккаунт.
  return { ok: true, message: t("auth.reset.sent") };
}

export async function updatePassword(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = newPasswordSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const token = String(formData.get("token") ?? "");
  const userId = token ? await resetPassword(getDb(), token, parsed.data.password) : null;
  if (!userId) return { message: t("auth.newPassword.linkExpired") };
  await startSession(userId);
  redirect("/dzisiaj");
}

export async function signOut() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) await deleteSession(getDb(), token);
  store.delete(SESSION_COOKIE);
  store.delete(ORG_COOKIE);
  redirect("/logowanie");
}

/** Переключатель фирм (Owo Ads работает с несколькими клиентами). */
export async function switchOrganization(organizationId: string) {
  (await cookies()).set(ORG_COOKIE, organizationId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 365,
  });
  redirect("/dzisiaj");
}
