import type { Metadata } from "next";
import { ResetForm } from "../_components/auth-forms";
import { AuthHeading } from "../_components/auth-heading";
import { t } from "@/lib/i18n";

export const metadata: Metadata = { title: t("auth.reset.title") };

export default function ResetPage() {
  return (
    <>
      <AuthHeading title={t("auth.reset.title")} subtitle={t("auth.reset.subtitle")} />
      <ResetForm />
    </>
  );
}
