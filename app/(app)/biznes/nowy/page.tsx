import { redirect } from "next/navigation";
import { Card, PageHeader } from "@/components/app-shell/page";
import { BusinessForm } from "@/components/team/forms";
import { requireUser } from "@/lib/auth/session";
import { t } from "@/lib/i18n";

export default async function NewBusinessPage() {
  const user = await requireUser();
  if (!user.isPlatformAdmin) redirect("/dzisiaj");
  return (
    <div className="max-w-xl">
      <PageHeader title={t("business.newTitle")} subtitle={t("business.newIntro")} />
      <Card>
        <BusinessForm />
      </Card>
    </div>
  );
}
