import type { Metadata } from "next";
import { Card, PageHeader } from "@/components/app-shell/page";
import {
  ContributionsPanel,
  NewServiceForm,
  ServiceRow,
  StarterCatalog,
} from "@/components/agency/services-ui";
import { AgencyTabs } from "@/components/agency/tabs";
import { getOrderFormData } from "@/lib/agency/repository";
import { listContributions, listServices } from "@/lib/agency/services";
import { t } from "@/lib/i18n";

export const metadata: Metadata = { title: t("agency.services.title") };

/** Каталог услуг агентства с ответственными (65 %) и вклады партнёров в фонд. */
export default async function ServicesPage() {
  const [services, data, contributions] = await Promise.all([
    listServices(),
    getOrderFormData(),
    listContributions(),
  ]);
  const system = services.filter((s) => s.system_key !== null);
  const custom = services.filter((s) => s.system_key === null);
  return (
    <>
      <PageHeader
        back={{ href: "/agencja", label: t("nav.agency") }}
        title={t("agency.services.title")}
        subtitle={t("agency.services.intro")}
        aside={<AgencyTabs current="services" />}
      />
      <div className="grid gap-5">
        <Card title={t("agency.services.builtIn")}>
          <p className="text-ink-soft -mt-1 mb-1 text-[13px]">{t("agency.services.builtInHint")}</p>
          <ul className="divide-line divide-y" data-testid="service-list-system">
            {system.map((s) => (
              <ServiceRow key={s.id} service={s} members={data.members} />
            ))}
          </ul>
        </Card>
        <Card title={t("agency.services.other")}>
          <p className="text-ink-soft -mt-1 mb-1 text-[13px]">{t("agency.services.otherHint")}</p>
          {custom.length === 0 ? (
            <StarterCatalog members={data.members} currentUserId={data.currentUserId} />
          ) : (
            <>
              <ul className="divide-line divide-y" data-testid="service-list">
                {custom.map((s) => (
                  <ServiceRow key={s.id} service={s} members={data.members} />
                ))}
              </ul>
              <div className="border-line mt-3 border-t pt-4">
                <NewServiceForm members={data.members} currentUserId={data.currentUserId} />
              </div>
            </>
          )}
        </Card>
        <Card title={t("agency.services.contributions")}>
          <p className="text-ink-soft -mt-1 mb-3 text-[13px]">
            {t("agency.services.contributionsHint")}
          </p>
          <ContributionsPanel
            items={contributions}
            members={data.members}
            currentUserId={data.currentUserId}
          />
        </Card>
      </div>
    </>
  );
}
