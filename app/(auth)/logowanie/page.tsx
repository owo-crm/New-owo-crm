import type { Metadata } from "next";
import { SignInForm } from "../_components/auth-forms";
import { AuthHeading } from "../_components/auth-heading";
import { t } from "@/lib/i18n";
import { appConfig } from "@/lib/config";
import { safeNextPath } from "@/lib/auth/schemas";

// Настройка REGISTRATION_OPEN читается при запросе, а не при сборке.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: t("auth.login.title") };

export default async function LoginPage({ searchParams }: PageProps<"/logowanie">) {
  const { next } = await searchParams;
  const nextPath = typeof next === "string" ? safeNextPath(next) : undefined;
  return (
    <>
      <AuthHeading title={t("auth.login.title")} subtitle={t("auth.login.subtitle")} />
      <SignInForm next={nextPath} canRegister={appConfig.registrationOpen} />
    </>
  );
}
