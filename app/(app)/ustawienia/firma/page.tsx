import type { Metadata } from "next";
import { Card, PageHeader } from "@/components/app-shell/page";
import { CompanyForm } from "@/components/settings/company-form";
import { AvatarUpload } from "@/components/settings/avatar-upload";
import { uploadOrganizationAvatar } from "@/lib/avatars/actions";
import { avatarUrl } from "@/lib/avatars/image";
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
      <Card className="mb-5">
        <AvatarUpload
          kind="org"
          id={organization.id}
          name={organization.name}
          src={avatarUrl("o", organization.id, organization.avatarVersion)}
          title={t("avatar.logoTitle")}
          hint={t("avatar.logoHint")}
          disabled={!["owner", "admin"].includes(organization.role)}
          action={uploadOrganizationAvatar}
        />
      </Card>
      <Card>
        <p className="text-ink-soft mb-5 text-sm">{t("company.intro")}</p>
        <CompanyForm initial={profile} canEdit={["owner", "admin"].includes(organization.role)} />
      </Card>
    </div>
  );
}
