import { Card, PageHeader } from "@/components/app-shell/page";
import { ChannelForm } from "@/components/settings/channel-form";
import { withOrg } from "@/lib/db/user";
import { appConfig } from "@/lib/config";
import { t } from "@/lib/i18n";

type Row = {
  id: string;
  type: string;
  name: string;
  public_key: string;
  status: string;
  last_received_at: string | null;
  config: { allowedOrigins?: string[]; honeypotField?: string; forwardUrl?: string };
};

export default async function ChannelsPage() {
  const { channels, canEdit } = await withOrg(async (tx, { organization }) => ({
    canEdit: ["owner", "admin"].includes(organization.role),
    channels: (
      await tx.query<Row>(
        "select id,type,name,public_key,status,last_received_at,config from public.channels where organization_id=$1 order by created_at",
        [organization.id],
      )
    ).rows,
  }));
  const website = channels.filter((c) => c.type === "website");
  const fmt = (d: string) =>
    new Intl.DateTimeFormat("pl-PL", {
      dateStyle: "short",
      timeStyle: "short",
      timeZone: "Europe/Warsaw",
    }).format(new Date(d));
  return (
    <div className="grid max-w-3xl gap-5">
      <PageHeader title={t("channels.title")} subtitle={t("channels.intro")} />
      {website.length === 0 ? <p className="text-ink-soft">{t("channels.empty")}</p> : null}
      {website.map((c) => (
        <Card key={c.id} title={c.name}>
          <p className="text-ink-soft text-xs font-bold">{t("channels.endpoint")}</p>
          <code className="bg-surface-2 mt-1 block rounded-lg p-3 text-sm break-all select-all">
            {`${appConfig.siteUrl}/api/intake/${c.public_key}`}
          </code>
          <p className="text-ink-soft mt-2 text-sm">
            {c.last_received_at
              ? t("channels.lastReceived", { date: fmt(c.last_received_at) })
              : t("channels.never")}
          </p>
          {canEdit ? (
            <details className="mt-4">
              <summary className="cursor-pointer text-sm font-semibold">
                {t("channels.edit")}
              </summary>
              <div className="mt-4">
                <ChannelForm
                  channel={{
                    id: c.id,
                    name: c.name,
                    origins: (c.config.allowedOrigins ?? []).join(", "),
                    honeypot: c.config.honeypotField ?? "",
                    forward: c.config.forwardUrl ?? "",
                  }}
                />
              </div>
            </details>
          ) : null}
        </Card>
      ))}
      {canEdit ? (
        <Card title={t("channels.addTitle")}>
          <ChannelForm />
        </Card>
      ) : (
        <p className="text-ink-soft text-sm">{t("channels.adminOnly")}</p>
      )}
    </div>
  );
}
