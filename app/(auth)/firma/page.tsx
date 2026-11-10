import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthHeading } from "../_components/auth-heading";
import { CreateOrganizationForm } from "./create-organization-form";
import { getOrganizations, requireUser } from "@/lib/auth/session";
import { t } from "@/lib/i18n";

export const metadata: Metadata = { title: t("onboarding.company.title") };

export default async function CompanyPage() {
  await requireUser();
  const orgs = await getOrganizations();
  if (orgs.length > 0) redirect("/dzisiaj");

  return (
    <>
      <AuthHeading
        title={t("onboarding.company.title")}
        subtitle={t("onboarding.company.subtitle")}
      />
      <CreateOrganizationForm />
    </>
  );
}
