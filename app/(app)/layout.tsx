import { LogOut } from "lucide-react";
import { BottomNav, NavLink, SidebarNav } from "@/components/app-shell/nav";
import { SETTINGS, navItems } from "@/components/app-shell/nav-items";
import { BusinessSwitcher } from "@/components/app-shell/business-switcher";
import { CommandButton, CommandMenu } from "@/components/app-shell/command-menu";
import { ThemeToggle } from "@/components/app-shell/theme-toggle";
import { getOrganizations, requireOrganization } from "@/lib/auth/session";
import { signOut } from "@/lib/auth/actions";
import { getWorkQueue } from "@/lib/leads/dashboard";
import { t } from "@/lib/i18n";
import { isAgency } from "@/lib/presets";

/**
 * Оболочка приложения (решение 024): слева спокойное меню на фоне, справа рабочая область
 * на светлой «панели». Цвет бизнеса (--brand) — только акцент. ⌘K — поиск отовсюду.
 */
export default async function AppLayout({ children }: LayoutProps<"/">) {
  const { user, organization } = await requireOrganization();
  const organizations = await getOrganizations();
  const queue = await getWorkQueue();
  const agency = isAgency(organization.industryPreset);
  const links = [...navItems(agency), SETTINGS].map(({ href, label }) => ({ href, label }));
  return (
    <div
      className="min-h-dvh lg:grid lg:grid-cols-[240px_minmax(0,1fr)]"
      style={{ "--brand": organization.brandColor } as React.CSSProperties}
    >
      <aside className="hidden lg:block">
        <div className="sticky top-0 flex h-dvh flex-col gap-4 px-3 py-3">
          <BusinessSwitcher
            current={organization}
            organizations={organizations}
            canCreate={user.isPlatformAdmin}
          />
          <CommandButton />
          <SidebarNav waiting={queue.waiting_count} agency={agency} />
          <div className="mt-auto grid gap-0.5">
            <NavLink href="/ustawienia" />
            <ThemeToggle className="text-ink-soft hover:bg-surface-2 hover:text-ink flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-[13.5px]" />
            <form action={signOut}>
              <button
                type="submit"
                className="text-ink-soft hover:bg-surface-2 hover:text-ink flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-[13.5px]"
              >
                <LogOut className="text-ink-faint size-4" />
                <span className="min-w-0 flex-1 truncate text-left">{t("auth.logout")}</span>
              </button>
            </form>
            <p className="text-ink-faint truncate px-2.5 pt-1 text-[12px]" title={user.email}>
              {user.email}
            </p>
          </div>
        </div>
      </aside>

      <div className="min-w-0 lg:py-2 lg:pr-2">
        <header className="border-line bg-bg/95 sticky top-0 z-20 flex items-center gap-2 border-b px-3 py-2 backdrop-blur lg:hidden">
          <BusinessSwitcher
            current={organization}
            organizations={organizations}
            canCreate={user.isPlatformAdmin}
            className="min-w-0 flex-1"
          />
          <CommandButton className="w-10 justify-center px-0 [&>kbd]:hidden [&>span]:hidden" />
          <ThemeToggle
            className="text-ink-soft hover:text-ink flex size-10 shrink-0 items-center justify-center rounded-lg"
            iconOnly
          />
        </header>
        <main className="lg:bg-surface lg:border-line min-h-[calc(100dvh-1rem)] lg:rounded-xl lg:border">
          <div className="mx-auto w-full max-w-[76rem] px-4 pt-5 pb-28 sm:px-6 lg:px-10 lg:pt-8 lg:pb-12">
            {children}
          </div>
        </main>
      </div>

      <BottomNav agency={agency} />
      <CommandMenu links={links} organizations={organizations} currentOrgId={organization.id} />
    </div>
  );
}
