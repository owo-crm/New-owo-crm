import type { Metadata } from "next";
import Link from "next/link";
import { Inbox } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/app-shell/page";
import { buttonVariants } from "@/components/ui/button";
import { LeadFiltersForm } from "@/components/leads/lead-filters";
import { Kanban } from "@/components/leads/kanban";
import { LeadList } from "@/components/leads/lead-list";
import { LiveUpdates } from "@/components/leads/live-updates";
import { requireOrganization } from "@/lib/auth/session";
import { getLeadOptions, getLeads } from "@/lib/leads/queries";
import { leadPageUrl, parseLeadFilters } from "@/lib/leads/filters";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
export const metadata: Metadata = { title: t("nav.leads") };
export default async function Page({ searchParams }: PageProps<"/leady">) {
  const { organization } = await requireOrganization();
  const filters = parseLeadFilters(await searchParams);
  const [{ leads, total }, options] = await Promise.all([getLeads(filters), getLeadOptions()]);
  const now = new Date().toISOString();
  return (
    <>
      <PageHeader
        title={t("nav.leads")}
        subtitle={t("leads.count", { count: total })}
        aside={
          <div className="flex flex-wrap items-center gap-2">
            <LiveUpdates organizationId={organization.id} />
            <nav
              aria-label={t("leads.view")}
              className="border-line flex rounded-[10px] border p-0.5"
            >
              {(["list", "board"] as const).map((view) => (
                <Link
                  key={view}
                  href={leadPageUrl({ ...filters, view }, 1)}
                  aria-current={filters.view === view ? "page" : undefined}
                  className={cn(
                    "h-8 rounded-lg px-3 text-[13px] leading-8 font-bold",
                    filters.view === view ? "bg-ink text-bg" : "text-ink-soft hover:text-ink",
                  )}
                >
                  {t(view === "list" ? "leads.listView" : "leads.boardView")}
                </Link>
              ))}
            </nav>
            {/* На телефоне новый лид добавляется кнопкой «＋» в нижней панели. */}
            <Link
              href="/leady/nowy"
              className={cn(buttonVariants({ variant: "primary" }), "max-sm:hidden")}
            >
              {t("leads.addLead")}
            </Link>
          </div>
        }
      />
      <LeadFiltersForm key={JSON.stringify(filters)} filters={filters} options={options} />
      {filters.view === "board" ? (
        <Kanban leads={leads} stages={options.stages} total={total} />
      ) : leads.length ? (
        <LeadList leads={leads} stages={options.stages} team={options.team} now={now} />
      ) : (
        <EmptyState
          icon={Inbox}
          title={t(
            Object.entries(filters).some(
              ([key, value]) => key !== "page" && key !== "view" && Boolean(value),
            )
              ? "leads.noResults"
              : "leads.emptyTitle",
          )}
          text={t("leads.emptyText")}
          action={
            <Link href="/leady" className={buttonVariants({ variant: "secondary" })}>
              {t("leads.clear")}
            </Link>
          }
        />
      )}
      <nav
        aria-label={t("leads.pagination")}
        className="mt-5 flex items-center justify-between gap-3 text-sm"
      >
        <span className="text-ink-soft">{t("leads.page", { page: filters.page })}</span>
        <div className="flex gap-2">
          {filters.page > 1 ? (
            <Link
              href={leadPageUrl(filters, filters.page - 1)}
              className={buttonVariants({ variant: "secondary" })}
            >
              {t("leads.previous")}
            </Link>
          ) : null}
          {filters.page * 50 < total ? (
            <Link
              href={leadPageUrl(filters, filters.page + 1)}
              className={buttonVariants({ variant: "secondary" })}
            >
              {t("leads.next")}
            </Link>
          ) : null}
        </div>
      </nav>
    </>
  );
}
