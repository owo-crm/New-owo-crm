import { Card, PageHeader } from "@/components/app-shell/page";
import { InviteForm, MemberControls, RevokeButton } from "@/components/team/forms";
import { withOrg } from "@/lib/db/user";
import { t, type MessageKey } from "@/lib/i18n";

type Member = { user_id: string; role: "owner" | "admin" | "member"; name: string; login: string };
type Invite = { id: string; role: string; note: string | null; expires_at: string };

export default async function TeamPage() {
  const data = await withOrg(async (tx, { user, organization }) => {
    const admin = ["owner", "admin"].includes(organization.role);
    const members = (
      await tx.query<Member>("select user_id, role, name, login from public.team_members($1)", [
        organization.id,
      ])
    ).rows;
    const invites = admin
      ? (
          await tx.query<Invite>(
            "select id, role, note, expires_at from public.invitations where organization_id=$1 and accepted_at is null and revoked_at is null and expires_at > now() order by created_at desc",
            [organization.id],
          )
        ).rows
      : [];
    return {
      members,
      invites,
      admin,
      owner: organization.role === "owner",
      me: user.id,
      org: organization.name,
    };
  });
  const date = (d: string) =>
    new Intl.DateTimeFormat("pl-PL", { dateStyle: "short", timeZone: "Europe/Warsaw" }).format(
      new Date(d),
    );
  return (
    <div className="grid max-w-3xl gap-5">
      <PageHeader title={`${t("team.title")} · ${data.org}`} subtitle={t("team.intro")} />
      <Card>
        <ul className="divide-line divide-y">
          {data.members.map((m) => (
            <li
              key={m.user_id}
              className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
            >
              <div className="min-w-0">
                <p className="truncate font-bold">
                  {m.name}
                  {m.user_id === data.me ? (
                    <span className="text-ink-faint font-medium"> ({t("team.you")})</span>
                  ) : null}
                </p>
                <p className="text-ink-soft truncate text-sm">{m.login}</p>
              </div>
              <MemberControls
                userId={m.user_id}
                role={m.role}
                canChangeRole={data.owner && m.user_id !== data.me}
                canRemove={data.admin && m.role !== "owner" && m.user_id !== data.me}
              />
            </li>
          ))}
        </ul>
      </Card>
      {data.admin ? (
        <>
          <Card title={t("team.inviteTitle")}>
            <InviteForm canInviteOwner={data.owner} />
          </Card>
          <Card title={t("team.pending")}>
            {data.invites.length === 0 ? (
              <p className="text-ink-soft text-sm">{t("team.noPending")}</p>
            ) : (
              <ul className="divide-line divide-y">
                {data.invites.map((i) => (
                  <li
                    key={i.id}
                    className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
                  >
                    <p className="text-sm">
                      <span className="font-bold">{i.note || "—"}</span>{" "}
                      <span className="text-ink-soft">
                        {t(`team.role_${i.role}` as MessageKey)},{" "}
                        {t("team.expires", { date: date(i.expires_at) })}
                      </span>
                    </p>
                    <RevokeButton id={i.id} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      ) : (
        <p className="text-ink-soft text-sm">{t("team.adminOnly")}</p>
      )}
    </div>
  );
}
