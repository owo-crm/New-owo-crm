import type { Metadata } from "next";
import { Card, PageHeader } from "@/components/app-shell/page";
import { CompanyForm } from "@/components/settings/company-form";
import { requireOrganization } from "@/lib/auth/session";
import { getOrganizationProfile } from "@/lib/organizations/profile";
import { t } from "@/lib/i18n";

export const metadata: Metadata = { title: t("company.title") };

export default async function CompanySettingsPage() {
  const { organization } = await requireOrganization();
  const profile = await getOrganizationProfile();
  return (
    <div className="max-w-2xl">
      <PageHeader
        back={{ href: "/ustawienia", label: t("nav.settings") }}
        title={t("company.title")}
      />
      <Card>
        <p className="text-ink-soft mb-5 text-sm">{t("company.intro")}</p>
        <CompanyForm initial={profile} canEdit={["owner", "admin"].includes(organization.role)} />
      </Card>
    </div>
  );
}
