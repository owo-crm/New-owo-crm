import type { Metadata } from "next";
import Link from "next/link";
import { SignUpForm } from "../_components/auth-forms";
import { AuthHeading } from "../_components/auth-heading";
import { appConfig } from "@/lib/config";
import { t } from "@/lib/i18n";

export const metadata: Metadata = { title: t("auth.register.title") };

export default function RegisterPage() {
  if (!appConfig.registrationOpen)
    return (
      <>
        <AuthHeading title={t("auth.register.title")} />
        <p className="border-line-strong text-ink-soft rounded-[10px] border p-4">
          {t("auth.register.closed")}
        </p>
        <Link
          href="/logowanie"
          className="mt-6 inline-block font-semibold underline underline-offset-4"
        >
          {t("auth.register.toLogin")}
        </Link>
      </>
    );
  return (
    <>
      <AuthHeading title={t("auth.register.title")} subtitle={t("auth.register.subtitle")} />
      <SignUpForm />
    </>
  );
}
