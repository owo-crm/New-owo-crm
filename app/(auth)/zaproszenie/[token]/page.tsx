import Link from "next/link";
import { AuthHeading } from "../../_components/auth-heading";
import { JoinForm, RegisterInviteForm } from "@/components/team/forms";
import { getDb } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { invitationInfo } from "@/lib/team/invitations";
import { t, type MessageKey } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export default async function InvitePage({ params }: PageProps<"/zaproszenie/[token]">) {
  const { token } = await params;
  const info = /^[A-Za-z0-9_-]{20,80}$/.test(token) ? await invitationInfo(getDb(), token) : null;
  if (!info)
    return (
      <>
        <AuthHeading title="Zaproszenie" />
        <p className="border-line-strong text-ink-soft rounded-[10px] border p-4">
          {t("team.inviteInvalid")}
        </p>
        <Link
          href="/logowanie"
          className="mt-6 inline-block font-semibold underline underline-offset-4"
        >
          {t("auth.register.toLogin")}
        </Link>
      </>
    );
  const user = await getCurrentUser();
  return (
    <>
      <AuthHeading
        title={t("team.joinTitle", { org: info.organization })}
        subtitle={t("team.joinAs", { role: t(`team.role_${info.role}` as MessageKey) })}
      />
      {user ? <JoinForm token={token} /> : <RegisterInviteForm token={token} />}
    </>
  );
}
