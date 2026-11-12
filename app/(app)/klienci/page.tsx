import type { Metadata } from "next";
import Link from "next/link";
import { Users } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/app-shell/page";
import { PeopleSearch } from "@/components/leads/people-search";
import { listClients } from "@/lib/leads/people";
import { getLeadOptions } from "@/lib/leads/queries";
import { plDate, plForm } from "@/lib/format";
import { t } from "@/lib/i18n";

export const metadata: Metadata = { title: t("nav.clients") };

/** Клиенты: по строке на человека, даже если обращений было несколько (решение 036). */
export default async function ClientsPage({ searchParams }: PageProps<"/klienci">) {
  const { q } = await searchParams;
  const query = typeof q === "string" ? q.slice(0, 80) : "";
  const [clients, options] = await Promise.all([listClients(query), getLeadOptions()]);
  const stageLabel = (key: string) => options.stages.find((s) => s.key === key)?.label_pl ?? key;

  return (
    <>
      <PageHeader title={t("nav.clients")} />
      <PeopleSearch base="/klienci" value={query} placeholder={t("clients.searchHint")} />
      {clients.length === 0 ? (
        <EmptyState icon={Users} title={t("clients.emptyTitle")} text={t("clients.emptyText")} />
      ) : (
        <ul className="border-line bg-surface divide-line divide-y overflow-hidden rounded-2xl border">
          {clients.map((c) => (
            <li key={c.person_key}>
              <Link
                href={`/leady/${c.lead_id}`}
                className="hover:bg-surface-2 flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{c.client_name}</span>
                  <span className="text-ink-soft block truncate text-[13px]">
                    {[c.phone_e164, c.email].filter(Boolean).join(" · ") || "—"}
                  </span>
                </span>
                {c.contracts > 0 ? (
                  <span className="badge badge-won">
                    {t(
                      plForm(
                        c.contracts,
                        "clients.contractsOne",
                        "clients.contractsFew",
                        "clients.contractsMany",
                      ),
                      { count: c.contracts },
                    )}
                  </span>
                ) : (
                  <span className="badge badge-open">{stageLabel(c.stage_key)}</span>
                )}
                {c.leads > 1 ? (
                  <span className="text-ink-faint text-[12.5px]">
                    {t(
                      plForm(c.leads, "clients.leadsOne", "clients.leadsFew", "clients.leadsMany"),
                      { count: c.leads },
                    )}
                  </span>
                ) : null}
                <span className="text-ink-soft w-24 shrink-0 text-right text-[13px] tabular-nums">
                  {c.last_event ? plDate(c.last_event) : "—"}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
