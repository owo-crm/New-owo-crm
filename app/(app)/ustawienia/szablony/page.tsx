import type { Metadata } from "next";
import { Card, PageHeader } from "@/components/app-shell/page";
import { TemplateForm } from "@/components/settings/template-form";
import { requireOrganization } from "@/lib/auth/session";
import { CONTRACT_FIELDS, templateInfo } from "@/lib/documents/templates";
import { t } from "@/lib/i18n";

export const metadata: Metadata = { title: t("templates.title") };

export default async function TemplatesSettingsPage() {
  const { organization } = await requireOrganization();
  const current = await templateInfo();
  return (
    <div className="max-w-2xl">
      <PageHeader
        back={{ href: "/ustawienia", label: t("nav.settings") }}
        title={t("templates.title")}
      />
      <Card>
        <p className="text-ink-soft mb-5 text-sm">{t("templates.intro")}</p>
        <TemplateForm
          current={current}
          fields={CONTRACT_FIELDS}
          canEdit={["owner", "admin"].includes(organization.role)}
        />
      </Card>
    </div>
  );
}
