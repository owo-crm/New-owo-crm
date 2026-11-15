import type { Metadata } from "next";
import Link from "next/link";
import {
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Inbox,
  MousePointerClick,
  Target,
  Trophy,
} from "lucide-react";
import { Card, PageHeader } from "@/components/app-shell/page";
import { StatCards } from "@/components/app-shell/stat-cards";
import { AccountButtons, AddAccountForm, ManualSpendForm } from "@/components/ads/forms";
import { buttonVariants } from "@/components/ui/button";
import { googleConfigured, metaConfigured } from "@/lib/ads/platforms";
import { withOrg } from "@/lib/db/user";
import { formatMoney } from "@/lib/finance/money";
import { addMonths, warsawToday } from "@/lib/format";
import { t, type MessageKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: t("ads.title") };

type Report = {
  spend_grosze: number;
  clicks: number;
  crm_leads: number;
  won: number;
  unmatched_leads: number;
  campaigns: {
    platform: "meta" | "google" | "manual";
    campaign_id: string;
    campaign_name: string;
    spend_grosze: number;
    clicks: number;
    platform_leads: number;
    crm_leads: number;
    won: number;
  }[];
};
type Account = {
  id: string;
  platform: "meta" | "google" | "manual";
  external_id: string | null;
  name: string;
  status: string;
  last_synced_at: string | null;
  last_error: string | null;
};

const TONE = { meta: "#3d6cf4", google: "#e0453a", manual: "var(--ink-soft)" } as const;
const money = (g: number | null) => (g === null ? "—" : formatMoney(g));

/** Вкладка «Reklama» (решение 046): расходы ↔ заявки CRM ↔ клиенты, по кампаниям. */
export default async function AdsPage({ searchParams }: PageProps<"/reklama">) {
  const raw = (await searchParams).m;
  const month =
    typeof raw === "string" && /^\d{4}-\d{2}$/.test(raw)
      ? `${raw}-01`
      : `${warsawToday().slice(0, 7)}-01`;
  const { report, accounts, canEdit } = await withOrg(async (tx, { organization }) => {
    const { rows } = await tx.query<{ d: Report }>(
      "select public.ads_report($1,$2::date,$3::date) as d",
      [organization.id, month, addMonths(month, 1)],
    );
    const { rows: accounts } = await tx.query<Account>(
      "select id, platform, external_id, name, status, last_synced_at, last_error from public.ad_accounts where organization_id=$1 order by created_at",
      [organization.id],
    );
    return { report: rows[0].d, accounts, canEdit: ["owner", "admin"].includes(organization.role) };
  });
  const n = (v: unknown) => Number(v ?? 0);
  const spend = n(report.spend_grosze);
  const leads = n(report.crm_leads);
  const won = n(report.won);
  const per = (a: number, b: number) => (b > 0 ? Math.round(a / b) : null);
  const link = (iso: string) => `/reklama?m=${iso.slice(0, 7)}`;
  const configured = {
    meta: metaConfigured(process.env),
    google: googleConfigured(process.env),
    manual: true,
  };
  const fmt = (d: string) =>
    new Intl.DateTimeFormat("pl-PL", {
      dateStyle: "short",
      timeStyle: "short",
      timeZone: "Europe/Warsaw",
    }).format(new Date(d));
  const [y, m] = month.split("-").map(Number);

  return (
    <>
      <PageHeader
        title={`${t("ads.title")} · ${t(`agency.months.${m}` as MessageKey)} ${y}`}
        aside={
          <div className="flex items-center gap-2">
            <Link
              href={link(addMonths(month, -1))}
              aria-label={t("finance.prev")}
              className={buttonVariants({ variant: "secondary", size: "icon" })}
            >
              <ChevronLeft className="size-4" />
            </Link>
            <Link href="/reklama" className={buttonVariants({ variant: "secondary" })}>
              {t("finance.current")}
            </Link>
            <Link
              href={link(addMonths(month, 1))}
              aria-label={t("finance.next")}
              className={buttonVariants({ variant: "secondary", size: "icon" })}
            >
              <ChevronRight className="size-4" />
            </Link>
          </div>
        }
      />
      <StatCards
        items={[
          {
            label: t("ads.spend"),
            value: formatMoney(spend),
            icon: CircleDollarSign,
            tone: "var(--hold)",
          },
          {
            label: t("ads.clicks"),
            value: String(n(report.clicks)),
            icon: MousePointerClick,
            tone: "#8b6cf0",
          },
          { label: t("ads.leads"), value: String(leads), icon: Inbox, tone: "var(--info)" },
          {
            label: t("ads.cpl"),
            value: money(per(spend, leads)),
            icon: Target,
            tone: "var(--accent)",
          },
          { label: t("ads.cpa"), value: money(per(spend, won)), icon: Trophy, tone: "var(--ok)" },
        ]}
      />

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <Card title={t("ads.campaigns")} data-testid="ads-campaigns">
          {report.campaigns.length === 0 ? (
            <p className="text-ink-soft text-[13.5px]">{t("ads.empty")}</p>
          ) : (
            <div className="-mx-1 overflow-x-auto px-1">
              <table className="w-full min-w-[40rem] text-[13.5px]">
                <thead className="text-ink-faint text-[12px]">
                  <tr>
                    <th className="pb-2 text-left font-medium">{t("ads.colCampaign")}</th>
                    <th className="pb-2 pl-3 text-right font-medium">{t("ads.colSpend")}</th>
                    <th className="pb-2 pl-3 text-right font-medium">{t("ads.colClicks")}</th>
                    <th className="pb-2 pl-3 text-right font-medium" title={t("ads.colLeadsHint")}>
                      {t("ads.colLeads")}
                    </th>
                    <th className="pb-2 pl-3 text-right font-medium">{t("ads.colWon")}</th>
                    <th className="pb-2 pl-3 text-right font-medium">{t("ads.colCpl")}</th>
                    <th className="pb-2 pl-3 text-right font-medium">{t("ads.colCpa")}</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {report.campaigns.map((c) => (
                    <tr key={`${c.platform}-${c.campaign_id}`} className="border-line border-t">
                      <td className="py-2.5">
                        <span className="flex items-center gap-2">
                          <span
                            className="badge"
                            style={{ "--badge": TONE[c.platform] } as React.CSSProperties}
                          >
                            {t(`ads.platform.${c.platform}` as MessageKey)}
                          </span>
                          <span className="truncate font-medium">{c.campaign_name}</span>
                        </span>
                      </td>
                      <td className="py-2.5 pl-3 text-right">{formatMoney(n(c.spend_grosze))}</td>
                      <td className="text-ink-soft py-2.5 pl-3 text-right">{n(c.clicks)}</td>
                      <td className="py-2.5 pl-3 text-right">
                        <span className="text-ink-faint">{n(c.platform_leads)} / </span>
                        {n(c.crm_leads)}
                      </td>
                      <td
                        className={cn(
                          "py-2.5 pl-3 text-right",
                          n(c.won) > 0 && "text-ok font-semibold",
                        )}
                      >
                        {n(c.won)}
                      </td>
                      <td className="py-2.5 pl-3 text-right">
                        {money(per(n(c.spend_grosze), n(c.crm_leads)))}
                      </td>
                      <td className="py-2.5 pl-3 text-right font-semibold">
                        {money(per(n(c.spend_grosze), n(c.won)))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {n(report.unmatched_leads) > 0 ? (
            <p className="text-hold mt-3 text-[13px]">
              {t("ads.unmatched", { count: n(report.unmatched_leads) })}
            </p>
          ) : null}
          <p className="text-ink-faint mt-3 text-[12.5px]">{t("ads.utmHint")}</p>
        </Card>

        <div className="grid gap-5">
          <Card title={t("ads.accounts")}>
            <p className="text-ink-soft -mt-1 mb-3 text-[13px]">{t("ads.accountsHint")}</p>
            <ul className="divide-line mb-4 divide-y">
              {accounts.map((a) => (
                <li key={a.id} className="flex items-center gap-2 py-2">
                  <span
                    className="badge"
                    style={{ "--badge": TONE[a.platform] } as React.CSSProperties}
                  >
                    {t(`ads.platform.${a.platform}` as MessageKey)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-medium">{a.name}</span>
                    <span
                      className={cn(
                        "block truncate text-[12px]",
                        a.last_error ? "text-urgent" : "text-ink-faint",
                      )}
                    >
                      {a.platform === "manual"
                        ? t("ads.manualHint")
                        : a.status !== "active"
                          ? t("ads.status.paused")
                          : !configured[a.platform]
                            ? t("ads.status.waitingKeys")
                            : a.last_error
                              ? t("ads.status.error", { error: a.last_error })
                              : a.last_synced_at
                                ? t("ads.status.ok", { date: fmt(a.last_synced_at) })
                                : t("ads.status.never")}
                    </span>
                  </span>
                  {canEdit && a.platform !== "manual" ? (
                    <AccountButtons id={a.id} active={a.status === "active"} />
                  ) : null}
                </li>
              ))}
            </ul>
            {canEdit ? <AddAccountForm /> : null}
          </Card>
          {canEdit ? (
            <Card title={t("ads.manualTitle")}>
              <p className="text-ink-soft -mt-1 mb-3 text-[13px]">{t("ads.manualHint")}</p>
              <ManualSpendForm month={month.slice(0, 7)} />
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
