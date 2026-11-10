import type { Metadata } from "next";
import { NewPasswordForm } from "../_components/auth-forms";
import { AuthHeading } from "../_components/auth-heading";
import { t } from "@/lib/i18n";

export const metadata: Metadata = { title: t("auth.newPassword.title") };

// Сюда пользователь попадает по ссылке из письма: /nowe-haslo?token=...
export default async function NewPasswordPage({ searchParams }: PageProps<"/nowe-haslo">) {
  const { token } = await searchParams;
  return (
    <>
      <AuthHeading title={t("auth.newPassword.title")} />
      <NewPasswordForm token={typeof token === "string" ? token : ""} />
    </>
  );
}
