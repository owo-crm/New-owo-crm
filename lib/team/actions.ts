"use server";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { withOrg } from "@/lib/db/user";
import { appConfig } from "@/lib/config";
import {
  getCurrentUser,
  requireOrganization,
  ORG_COOKIE,
  SESSION_COOKIE,
} from "@/lib/auth/session";
import { createSession, createUser, EmailTakenError } from "@/lib/auth/repository";
import { newPasswordSchema } from "@/lib/auth/schemas";
import { t } from "@/lib/i18n";
import { acceptInvitation, createInvitation, invitationInfo } from "./invitations";

export type InviteState = { error?: string; url?: string };

/** Адрес, по которому CRM открыта сейчас: ссылка-приглашение не зависит от настроек сборки. */
async function currentOrigin() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!host || !/^[a-z0-9.:-]+$/i.test(host)) return appConfig.siteUrl;
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export async function createInviteAction(_prev: InviteState, form: FormData): Promise<InviteState> {
  const { user, organization } = await requireOrganization();
  const parsed = z
    .object({ role: z.enum(["owner", "admin", "member"]), note: z.string().trim().max(120) })
    .safeParse({ role: form.get("role"), note: form.get("note") ?? "" });
  if (!parsed.success) return { error: t("team.error") };
  try {
    const token = await createInvitation(
      getDb(),
      user.id,
      organization.id,
      parsed.data.role,
      parsed.data.note,
    );
    revalidatePath("/ustawienia/zespol");
    return { url: `${await currentOrigin()}/zaproszenie/${token}` };
  } catch {
    return { error: t("team.notAllowed") };
  }
}

export async function revokeInviteAction(id: string) {
  await withOrg((tx, { organization }) =>
    tx.query("select public.revoke_invitation($1,$2)", [organization.id, z.uuid().parse(id)]),
  ).catch(() => {});
  revalidatePath("/ustawienia/zespol");
}

export async function removeMemberAction(userId: string) {
  await withOrg(async (tx, { user, organization }) => {
    // Себя из команды не удаляем; права (owner/admin, не владельца) проверяет RLS.
    if (userId === user.id) return;
    await tx.query("delete from public.memberships where organization_id=$1 and user_id=$2", [
      organization.id,
      z.uuid().parse(userId),
    ]);
  }).catch(() => {});
  revalidatePath("/ustawienia/zespol");
}

export async function setMemberRoleAction(userId: string, role: string) {
  await withOrg((tx, { organization }) =>
    tx.query("select public.set_member_role($1,$2,$3)", [
      organization.id,
      z.uuid().parse(userId),
      z.enum(["owner", "admin", "member"]).parse(role),
    ]),
  ).catch(() => {});
  revalidatePath("/ustawienia/zespol");
}

async function enter(orgId: string): Promise<never> {
  (await cookies()).set(ORG_COOKIE, orgId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 365,
  });
  redirect("/dzisiaj");
}

export type JoinState = { error?: string; login?: string; name?: string };

/** Вошедший пользователь принимает приглашение. */
export async function joinAction(_prev: JoinState, form: FormData): Promise<JoinState> {
  const user = await getCurrentUser();
  const token = String(form.get("token") ?? "");
  if (!user) redirect(`/logowanie?next=/zaproszenie/${encodeURIComponent(token)}`);
  let org: string;
  try {
    org = await acceptInvitation(getDb(), user.id, token);
  } catch {
    return { error: t("team.inviteInvalid") };
  }
  return enter(org);
}

const registerSchema = z.object({
  name: z.string().trim().min(2).max(120),
  login: z
    .string()
    .trim()
    .toLowerCase()
    .refine((v) => /^[a-z0-9._-]{3,32}$/.test(v) || z.email().safeParse(v).success),
  password: newPasswordSchema.shape.password,
});

/** Новый человек по ссылке: создаёт логин и пароль и сразу попадает в бизнес. */
export async function registerWithInviteAction(
  _prev: JoinState,
  form: FormData,
): Promise<JoinState> {
  const token = String(form.get("token") ?? "");
  const raw = { name: String(form.get("name") ?? ""), login: String(form.get("login") ?? "") };
  const parsed = registerSchema.safeParse({ ...raw, password: form.get("password") });
  if (!parsed.success) {
    const field = String(parsed.error.issues[0].path[0]);
    return {
      ...raw,
      error: t(
        field === "password"
          ? "auth.validation.passwordShort"
          : field === "name"
            ? "auth.validation.nameRequired"
            : "auth.validation.loginInvalid",
      ),
    };
  }
  const db = getDb();
  if (!(await invitationInfo(db, token))) return { ...raw, error: t("team.inviteInvalid") };
  let org: string;
  try {
    const userId = await createUser(db, {
      email: parsed.data.login,
      password: parsed.data.password,
      fullName: parsed.data.name,
    });
    org = await acceptInvitation(db, userId, token);
    const session = await createSession(db, userId, (await headers()).get("user-agent"));
    (await cookies()).set(SESSION_COOKIE, session.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      expires: session.expiresAt,
    });
  } catch (error) {
    return {
      ...raw,
      error: error instanceof EmailTakenError ? t("team.loginTaken") : t("common.unknownError"),
    };
  }
  return enter(org);
}
