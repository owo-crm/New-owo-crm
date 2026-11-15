import { Card, PageHeader } from "@/components/app-shell/page";
import { ChannelForm } from "@/components/settings/channel-form";
import {
  ChannelActions,
  EndpointBox,
  FieldMapForm,
  WebhookForm,
} from "@/components/settings/channel-controls";
import { withOrg } from "@/lib/db/user";
import { appConfig } from "@/lib/config";
import { t, type MessageKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type Row = {
  id: string;
  type: string;
  name: string;
  public_key: string;
  status: string;
  last_received_at: string | null;
  config: {
    allowedOrigins?: string[];
    honeypotField?: string;
    forwardUrl?: string;
    fieldMap?: Record<string, string>;
  };
};
type Attempt = {
  channel_id: string;
  received_at: string;
  ok: boolean;
  error: string | null;
  keys: string[] | null;
};

const fmt = (d: string) =>
  new Intl.DateTimeFormat("pl-PL", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Europe/Warsaw",
  }).format(new Date(d));

/** «Źródła leadów» (решение 044): все каналы, их адреса, последние попытки и проверка одним нажатием. */
export default async function ChannelsPage() {
  const { channels, attempts, canEdit } = await withOrg(async (tx, { organization }) => {
    const { rows: channels } = await tx.query<Row>(
      "select id,type,name,public_key,status,last_received_at,config from public.channels where organization_id=$1 and type in ('website','webhook') order by created_at",
      [organization.id],
    );
    // Последние 5 попыток на канал: время, результат, названия полей (без персональных данных).
    const { rows: attempts } = await tx.query<Attempt>(
      `select channel_id, received_at, ok, error, payload->'keys' as keys from (
         select l.*, row_number() over (partition by channel_id order by received_at desc) as n
         from public.intake_log l where organization_id=$1) x
       where n <= 5 order by received_at desc`,
      [organization.id],
    );
    return { channels, attempts, canEdit: ["owner", "admin"].includes(organization.role) };
  });
  const base = appConfig.siteUrl;

  return (
    <div className="grid max-w-3xl gap-5">
      <PageHeader
        back={{ href: "/ustawienia", label: t("nav.settings") }}
        title={t("channels.title")}
      />
      <p className="text-ink-soft -mt-3 text-[13.5px]">{t("channels.intro")}</p>
      {channels.length === 0 ? <p className="text-ink-soft">{t("channels.empty")}</p> : null}

      {channels.map((c) => {
        const own = attempts.filter((a) => a.channel_id === c.id);
        // Последняя принятая заявка: из канала или из журнала (вебхук пишет журнал сразу «ok»).
        const lastOk = c.last_received_at ?? own.find((a) => a.ok)?.received_at ?? null;
        const lastKeys = own.find((a) => a.keys?.length)?.keys ?? [];
        const webhook = c.type === "webhook";
        const active = c.status === "active";
        return (
          <Card key={c.id} data-testid="channel-card">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <h2 className="mr-auto text-[15px] font-semibold">{c.name}</h2>
              <span
                className="badge"
                style={{ "--badge": webhook ? "#8b6cf0" : "var(--info)" } as React.CSSProperties}
              >
                {t(webhook ? "channels.typeWebhook" : "channels.typeWebsite")}
              </span>
              <span className={cn("badge", active ? "badge-won" : "badge-lost")}>
                {t(active ? "channels.active" : "channels.paused")}
              </span>
            </div>
            <p className="text-ink-faint mb-1 text-[12px] font-medium">
              {t(webhook ? "channels.webhookEndpoint" : "channels.endpoint")}
            </p>
            <EndpointBox url={`${base}/api/${webhook ? "hook" : "intake"}/${c.public_key}`} />
            {webhook ? (
              <p className="text-ink-soft mt-2 text-[13px]">{t("channels.webhookHint")}</p>
            ) : null}
            <p className="text-ink-soft mt-3 text-[13px]">
              {lastOk ? t("channels.lastReceived", { date: fmt(lastOk) }) : t("channels.never")}
            </p>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div>
                <p className="text-ink-faint mb-1.5 text-[12px] font-medium">
                  {t("channels.attempts")}
                </p>
                {own.length === 0 ? (
                  <p className="text-ink-faint text-[13px]">{t("channels.noAttempts")}</p>
                ) : (
                  <ul className="grid gap-1 text-[13px]">
                    {own.map((a, i) => (
                      <li key={i} className="flex items-center gap-2">
                        <span
                          className={cn("size-2 rounded-full", a.ok ? "bg-ok" : "bg-urgent")}
                          aria-hidden
                        />
                        <span className="text-ink-faint tabular-nums">{fmt(a.received_at)}</span>
                        <span className={a.ok ? "text-ok" : "text-urgent"}>
                          {t(
                            `channels.errors.${a.ok ? "ok" : (a.error ?? "internal_error")}` as MessageKey,
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {webhook && lastKeys.length ? (
                <div>
                  <p className="text-ink-faint mb-1.5 text-[12px] font-medium">
                    {t("channels.fields")}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {lastKeys.map((k) => (
                      <code key={k} className="bg-surface-2 rounded px-1.5 py-0.5 text-[12px]">
                        {k}
                      </code>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>

            {canEdit ? (
              <div className="border-line mt-4 grid gap-4 border-t pt-4">
                <ChannelActions id={c.id} active={active} />
                {webhook ? (
                  <details>
                    <summary className="cursor-pointer text-[13.5px] font-semibold">
                      {t("channels.mapTitle")}
                    </summary>
                    <p className="text-ink-soft my-2 text-[13px]">{t("channels.mapHint")}</p>
                    <FieldMapForm
                      id={c.id}
                      initial={Object.entries(c.config.fieldMap ?? {})
                        .map(([k, v]) => `${k} = ${v}`)
                        .join("\n")}
                    />
                  </details>
                ) : (
                  <details>
                    <summary className="cursor-pointer text-[13.5px] font-semibold">
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
                )}
              </div>
            ) : null}
          </Card>
        );
      })}

      {canEdit ? (
        <div className="grid gap-5 sm:grid-cols-2">
          <Card title={t("channels.addTitle")}>
            <ChannelForm />
          </Card>
          <Card title={t("channels.addWebhookTitle")}>
            <WebhookForm />
          </Card>
        </div>
      ) : (
        <p className="text-ink-soft text-sm">{t("channels.adminOnly")}</p>
      )}
    </div>
  );
}
