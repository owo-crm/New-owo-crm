import Link from "next/link";
import type { Metadata } from "next";
import {
  BarChart3,
  Bell,
  Building2,
  CreditCard,
  FileStack,
  LogOut,
  PlugZap,
  Upload,
} from "lucide-react";
import { PageHeader } from "@/components/app-shell/page";
import { Button } from "@/components/ui/button";
import { AvatarUpload } from "@/components/settings/avatar-upload";
import { uploadProfileAvatar } from "@/lib/avatars/actions";
import { avatarUrl } from "@/lib/avatars/image";
import { requireOrganization } from "@/lib/auth/session";
import { signOut } from "@/lib/auth/actions";
import { t, type MessageKey } from "@/lib/i18n";

export const metadata: Metadata = { title: t("settings.title") };

const SECTIONS: {
  title: MessageKey;
  text: MessageKey;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { title: "settings.company", text: "settings.companyText", icon: Building2 },
  { title: "settings.templates", text: "settings.templatesText", icon: FileStack },
  { title: "settings.channels", text: "settings.channelsText", icon: PlugZap },
  { title: "settings.notifications", text: "settings.notificationsText", icon: Bell },
  { title: "settings.import", text: "settings.importText", icon: Upload },
  { title: "billing.settings.title", text: "billing.settings.text", icon: CreditCard },
  // На телефоне у агентства в нижней панели «Agencja» — статистика доступна отсюда.
  { title: "nav.stats", text: "settings.statsText", icon: BarChart3 },
];

/** Цвет иконки раздела — чтобы список настроек не сливался. */
const TONE: Partial<Record<string, string>> = {
  "settings.company": "var(--accent)",
  "settings.templates": "var(--hold)",
  "settings.channels": "var(--info)",
  "settings.notifications": "var(--urgent)",
  "settings.import": "var(--ink-soft)",
  "billing.settings.title": "var(--accent)",
  "nav.stats": "var(--info)",
};

const LINKS: Partial<Record<string, string>> = {
  "settings.company": "/ustawienia/firma",
  "settings.templates": "/ustawienia/szablony",
  "settings.notifications": "/ustawienia/powiadomienia",
  "settings.channels": "/ustawienia/zrodla",
  "settings.import": "/ustawienia/import",
  "billing.settings.title": "/ustawienia/abonament",
  "nav.stats": "/statystyka",
};

export default async function SettingsPage() {
  const { user } = await requireOrganization();
  return (
    <>
      <PageHeader title={t("settings.title")} />
      <ul className="divide-line border-line bg-surface divide-y overflow-hidden rounded-xl border">
        {SECTIONS.map(({ title, text, icon: Icon }) => (
          <li key={title} className="flex items-center gap-4 px-5 py-4">
            <span
              className="flex size-9 shrink-0 items-center justify-center rounded-lg"
              style={{
                background: `color-mix(in srgb, ${TONE[title] ?? "var(--accent)"} 12%, transparent)`,
                color: TONE[title] ?? "var(--accent)",
              }}
            >
              <Icon className="size-[18px]" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{t(title)}</p>
              <p className="text-ink-soft text-sm">{t(text)}</p>
            </div>
            {LINKS[title] ? (
              <Link
                href={LINKS[title]!}
                className="text-ink-soft hover:text-ink inline-flex min-h-11 items-center text-sm font-semibold"
              >
                {t("leads.open")}
              </Link>
            ) : (
              <span className="bg-surface-2 text-ink-soft rounded-full px-2.5 py-1 text-xs font-semibold">
                {t("common.soon")}
              </span>
            )}
          </li>
        ))}
      </ul>

      <Link href="/zainstaluj" className="mt-6 inline-flex min-h-11 items-center underline">
        {t("pwa.title")}
      </Link>
      <section className="mt-10">
        <h2 className="text-xl font-medium">{t("settings.account")}</h2>
        <p className="text-ink-soft mt-1">{t("settings.signedInAs", { email: user.email })}</p>
        <div className="border-line bg-surface mt-4 max-w-xl rounded-xl border p-5">
          <AvatarUpload
            kind="user"
            id={user.id}
            name={user.fullName || user.email}
            src={avatarUrl("u", user.id, user.avatarVersion)}
            title={t("avatar.photoTitle")}
            hint={t("avatar.photoHint")}
            action={uploadProfileAvatar}
          />
        </div>
        <form action={signOut} className="mt-4">
          <Button variant="secondary" type="submit">
            <LogOut />
            {t("auth.logout")}
          </Button>
        </form>
      </section>
    </>
  );
}
