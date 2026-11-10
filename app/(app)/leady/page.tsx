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
export const metadata: Metadata = { title: t("nav.leads") };
export default async function Page({ searchParams }: PageProps<"/leady">) {
  const { organization } = await requireOrganization();
  const filters = parseLeadFilters(await searchParams);
  const [{ leads, total }, options] = await Promise.all([getLeads(filters), getLeadOptions()]);
  return (
    <>
      <PageHeader
        title={t("nav.leads")}
        subtitle={t("leads.count", { count: total })}
        aside={
          <div className="grid gap-2">
            <nav aria-label={t("leads.view")} className="flex gap-2 sm:justify-end">
              <Link href="/leady/nowy" className={buttonVariants({ variant: "primary" })}>
                {t("leads.addLead")}
              </Link>
              {(["list", "board"] as const).map((view) => (
                <Link
                  key={view}
                  href={leadPageUrl({ ...filters, view }, 1)}
                  aria-current={filters.view === view ? "page" : undefined}
                  className={buttonVariants({
                    variant: filters.view === view ? "primary" : "secondary",
                  })}
                >
                  {t(view === "list" ? "leads.listView" : "leads.boardView")}
                </Link>
              ))}
            </nav>
            <LiveUpdates organizationId={organization.id} />
          </div>
        }
      />
      <LeadFiltersForm key={JSON.stringify(filters)} filters={filters} options={options} />
      {filters.view === "board" ? (
        <Kanban leads={leads} stages={options.stages} total={total} />
      ) : leads.length ? (
        <LeadList leads={leads} stages={options.stages} />
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
