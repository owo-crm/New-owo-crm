import type { Metadata } from "next";
import Link from "next/link";
import { FileSignature } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/app-shell/page";
import { PeopleSearch } from "@/components/leads/people-search";
import { listContracts } from "@/lib/leads/people";
import { formatMoney } from "@/lib/finance/money";
import { plDate } from "@/lib/format";
import { t } from "@/lib/i18n";

export const metadata: Metadata = { title: t("nav.contracts") };

/** Умовы: по строке на подписанную умову. Один клиент может подписать их несколько. */
export default async function ContractsPage({ searchParams }: PageProps<"/umowy">) {
  const { q } = await searchParams;
  const query = typeof q === "string" ? q.slice(0, 80) : "";
  const contracts = await listContracts(query);

  return (
    <>
      <PageHeader title={t("nav.contracts")} />
      <PeopleSearch base="/umowy" value={query} placeholder={t("contracts.searchHint")} />
      {contracts.length === 0 ? (
        <EmptyState
          icon={FileSignature}
          title={t("contracts.emptyTitle")}
          text={t("contracts.emptyText")}
        />
      ) : (
        <ul className="border-line bg-surface divide-line divide-y overflow-hidden rounded-2xl border">
          {contracts.map((c) => (
            <li key={c.lead_id}>
              <Link
                href={`/leady/${c.lead_id}`}
                className="hover:bg-surface-2 flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3"
              >
                <span className="text-ink-faint w-20 shrink-0 text-[12.5px] tabular-nums">
                  {c.number ?? "—"}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{c.client_name}</span>
                  <span className="text-ink-soft block truncate text-[13px]">
                    {[c.event_date ? plDate(c.event_date) : null, c.event_type, c.event_city]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  </span>
                </span>
                {c.amount_grosze > 0 ? (
                  <span className="shrink-0 text-right">
                    <span className="block font-semibold tabular-nums">
                      {formatMoney(c.amount_grosze)}
                    </span>
                    <span
                      className={
                        c.paid_grosze >= c.amount_grosze
                          ? "text-ok block text-[12.5px] font-semibold"
                          : "text-ink-soft block text-[12.5px]"
                      }
                    >
                      {t("contracts.paid", { sum: formatMoney(c.paid_grosze) })}
                    </span>
                  </span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
